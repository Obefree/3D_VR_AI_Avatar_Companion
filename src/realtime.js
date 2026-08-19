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
    this.onStatus?.('connecting');
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.pc = new RTCPeerConnection();
    this.pc.ontrack = event => {
      this.audioElement.srcObject = event.streams[0];
      this.audioElement.play().catch(() => {});
    };
    for (const track of this.localStream.getTracks()) this.pc.addTrack(track, this.localStream);

    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.addEventListener('open', () => {
      this.connected = true;
      this.onStatus?.('connected');
      this.pushSceneContext(true);
    });
    this.dc.addEventListener('close', () => {
      this.connected = false;
      this.onStatus?.('closed');
    });
    this.dc.addEventListener('message', event => this.#handleEvent(JSON.parse(event.data)));

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const response = await fetch('./api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: offer.sdp }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Session endpoint failed (${response.status})`);
    }
    const answerSdp = await response.text();
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  disconnect() {
    this.localStream?.getTracks().forEach(track => track.stop());
    this.dc?.close();
    this.pc?.close();
    this.connected = false;
    this.onStatus?.('closed');
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
          item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify(result) },
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
