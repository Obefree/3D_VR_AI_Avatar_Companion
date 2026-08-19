const BASE_INSTRUCTIONS = `
You are Nova, a concise embodied spatial AI companion inside an XR/web 3D scene.
You can only perceive scene facts explicitly supplied in CURRENT SCENE CONTEXT.
Never invent target IDs or claim to see something that is not present in context.
When the user asks where something is, requests a demonstration, or asks what to touch, use spatial tools.
Prefer short spoken answers. Combine speech with tools when helpful.
When a spatial reference is ambiguous, ask a short clarification instead of guessing.
The current guided task is servicing a demo device. The red_button is the reset control and the filter is the replaceable component.
`;

export class RealtimeCompanion {
  constructor({ audioElement, scene, onStatus, onMessage, onPartialAssistant, onTool }) {
    this.audioElement = audioElement;
    this.scene = scene;
    this.onStatus = onStatus;
    this.onMessage = onMessage;
    this.onPartialAssistant = onPartialAssistant;
    this.onTool = onTool;
    this.pc = null;
    this.dc = null;
    this.localStream = null;
    this.connected = false;
    this.currentAssistant = '';
    this.lastContextJson = '';
  }

  async connect() {
    if (this.connected) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not available in this browser.');
    if (!window.RTCPeerConnection) throw new Error('WebRTC is not available in this browser.');

    this.onStatus?.('connecting');

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.pc = new RTCPeerConnection();

      this.pc.ontrack = (event) => {
        const stream = event.streams?.[0];
        if (!stream) return;
        this.audioElement.srcObject = stream;
        this.audioElement.play().catch(() => {});
      };

      this.pc.onconnectionstatechange = () => {
        const state = this.pc?.connectionState;
        if (state === 'failed' || state === 'disconnected') {
          this.connected = false;
          this.onStatus?.('error', `WebRTC connection ${state}.`);
        }
      };

      for (const track of this.localStream.getTracks()) {
        this.pc.addTrack(track, this.localStream);
      }

      const channelOpened = new Promise((resolve, reject) => {
        this.dc = this.pc.createDataChannel('oai-events');
        this.dc.addEventListener('open', () => {
          this.connected = true;
          this.onStatus?.('connected');
          this.pushSceneContext(true);
          resolve();
        }, { once: true });
        this.dc.addEventListener('close', () => {
          this.connected = false;
          this.onStatus?.('closed');
        });
        this.dc.addEventListener('error', () => reject(new Error('Realtime data channel failed.')), { once: true });
        this.dc.addEventListener('message', (event) => {
          try {
            this.#handleEvent(JSON.parse(event.data));
          } catch (error) {
            console.error('Failed to parse Realtime event:', error, event.data);
          }
        });
      });

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      const response = await fetch('./api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
        cache: 'no-store',
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Session endpoint failed (${response.status}).`);
      }

      const answerSdp = await response.text();
      if (!answerSdp.includes('v=0')) throw new Error('The session endpoint did not return a valid SDP answer.');
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      await Promise.race([
        channelOpened,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for Realtime data channel.')), 12000)),
      ]);
    } catch (error) {
      this.disconnect(false);
      throw error;
    }
  }

  disconnect(report = true) {
    this.localStream?.getTracks().forEach((track) => track.stop());
    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.localStream = null;
    this.dc = null;
    this.pc = null;
    this.connected = false;
    if (report) this.onStatus?.('closed');
  }

  sendText(text) {
    if (!this.connected || this.dc?.readyState !== 'open') throw new Error('Live AI is not connected.');
    this.pushSceneContext(true);
    this.#send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
    this.onMessage?.('user', text);
    this.#send({ type: 'response.create' });
  }

  pushSceneContext(force = false) {
    if (!this.connected || this.dc?.readyState !== 'open') return;
    const context = this.scene.getSceneContext();
    const contextJson = JSON.stringify(context);
    if (!force && contextJson === this.lastContextJson) return;
    this.lastContextJson = contextJson;
    this.#send({
      type: 'session.update',
      session: {
        instructions: `${BASE_INSTRUCTIONS}\nCURRENT SCENE CONTEXT:\n${JSON.stringify(context, null, 2)}`,
      },
    });
  }

  #send(payload) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(payload));
  }

  async #handleEvent(event) {
    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        return;

      case 'input_audio_buffer.speech_started':
        this.scene.setState('listening');
        this.onStatus?.('listening');
        return;

      case 'input_audio_buffer.speech_stopped':
        this.scene.setState('thinking');
        this.onStatus?.('thinking');
        this.pushSceneContext(true);
        return;

      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript?.trim()) this.onMessage?.('user', event.transcript.trim());
        return;

      case 'response.output_audio_transcript.delta':
        this.scene.setState('speaking');
        this.onStatus?.('speaking');
        this.currentAssistant += event.delta ?? '';
        this.onPartialAssistant?.(this.currentAssistant);
        return;

      case 'response.output_audio_transcript.done': {
        const finalText = (event.transcript || this.currentAssistant).trim();
        if (finalText) this.onMessage?.('assistant', finalText, true);
        this.currentAssistant = '';
        return;
      }

      case 'response.function_call_arguments.done': {
        let args = {};
        try { args = JSON.parse(event.arguments || '{}'); } catch {}
        this.onTool?.(event.name, args);
        const result = await this.scene.executeTool(event.name, args);
        this.#send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: event.call_id,
            output: JSON.stringify(result),
          },
        });
        this.#send({ type: 'response.create' });
        return;
      }

      case 'response.done':
        if (!this.currentAssistant) {
          this.scene.setState('idle');
          this.onStatus?.('connected');
        }
        return;

      case 'error':
        console.error('Realtime error', event);
        this.onStatus?.('error', event.error?.message || 'Realtime API error');
        return;
    }
  }
}
