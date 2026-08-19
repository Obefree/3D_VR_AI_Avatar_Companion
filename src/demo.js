export class DemoCompanion {
  constructor({ scene, onMessage, onTool, onStatus }) {
    this.scene = scene;
    this.onMessage = onMessage;
    this.onTool = onTool;
    this.onStatus = onStatus;
  }

  async respond(text) {
    this.onMessage?.('user', text);
    this.scene.setState('thinking');
    this.onStatus?.('thinking');
    await wait(430);

    const lower = text.toLowerCase();
    const focus = this.scene.getSceneContext().gazeTarget;

    if (lower.includes('red') || lower.includes('button') || lower.includes('кноп')) {
      await this.#tool('look_at', { targetId: 'red_button' });
      await this.#tool('point_at', { targetId: 'red_button' });
      await this.#tool('highlight', { targetId: 'red_button', seconds: 3 });
      return this.#say('The red control on the right is the reset button. Start with this one.');
    }

    if (lower.includes('next') || lower.includes('дальш') || lower.includes('filter') || lower.includes('фильтр')) {
      await this.#tool('look_at', { targetId: 'filter' });
      await this.#tool('point_at', { targetId: 'filter' });
      await this.#tool('highlight', { targetId: 'filter', seconds: 3 });
      return this.#say('Next, remove the cylindrical filter below the front panel.');
    }

    if (lower.includes('looking') || lower.includes('this') || lower.includes('это') || lower.includes('смотр')) {
      if (!focus) return this.#say('Move the center reticle onto one of the device parts and ask me again.');
      await this.#tool('look_at', { targetId: focus });
      const label = this.scene.targets.get(focus)?.label ?? focus;
      return this.#say(`You are looking at the ${label}. I can point to it or guide you through the task.`);
    }

    if (lower.includes('help') || lower.includes('fix') || lower.includes('помог')) {
      await this.#tool('move_near', { targetId: 'device' });
      await this.#tool('look_at', { targetId: 'device' });
      return this.#say('Sure. I will guide you step by step. First, find the reset control on the front panel.');
    }

    return this.#say('I am a spatial AI companion. Ask me what you are looking at, or ask me to show you the reset button.');
  }

  async runGuidedDemo() {
    this.onStatus?.('demo');
    await this.#say('Hi. I am Nova, a spatial AI companion.');
    await wait(500);
    this.onMessage?.('user', 'Can you help me with this device?');
    this.scene.setState('thinking');
    await wait(450);
    await this.#tool('move_near', { targetId: 'device' });
    await this.#tool('look_at', { targetId: 'device' });
    await this.#say('Of course. I can use scene context and spatial actions to guide you.');
    await wait(650);
    this.onMessage?.('user', 'Show me what I should touch first.');
    this.scene.setState('thinking');
    await wait(450);
    await this.#tool('look_at', { targetId: 'red_button' });
    await this.#tool('point_at', { targetId: 'red_button' });
    await this.#tool('highlight', { targetId: 'red_button', seconds: 3 });
    await this.#say('Start with the red reset button on the right.');
  }

  async #tool(name, args) {
    this.onTool?.(name, args);
    return this.scene.executeTool(name, args);
  }

  async #say(text) {
    this.scene.setState('speaking');
    this.onStatus?.('speaking');
    this.onMessage?.('assistant', text);
    speak(text);
    await wait(Math.min(2300, 550 + text.length * 20));
    this.scene.setState('idle');
    this.onStatus?.('demo');
  }
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.pitch = 1.08;
  utterance.volume = 0.82;
  speechSynthesis.speak(utterance);
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
