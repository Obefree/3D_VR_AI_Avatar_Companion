export class BrowserVoiceDemo {
  constructor({ onTranscript, onStatus }) {
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(Recognition);
    if (Recognition) {
      this.recognition = new Recognition();
      this.recognition.lang = 'en-US';
      this.recognition.interimResults = false;
      this.recognition.continuous = false;
      this.recognition.maxAlternatives = 1;
      this.recognition.onstart = () => this.onStatus?.('listening');
      this.recognition.onerror = e => this.onStatus?.('demo', e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice input error: ${e.error}`);
      this.recognition.onend = () => this.onStatus?.('demo');
      this.recognition.onresult = e => {
        const text = e.results?.[0]?.[0]?.transcript?.trim();
        if (text) this.onTranscript?.(text);
      };
    }
  }

  start() {
    if (!this.supported) throw new Error('Browser speech recognition is not supported here. Use Chrome/Edge or type a message.');
    this.recognition.start();
  }
}
