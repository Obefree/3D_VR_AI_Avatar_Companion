import { SpatialScene } from './scene.js';
import { DemoCompanion } from './demo.js';
import { RealtimeCompanion } from './realtime.js';

const $ = id => document.getElementById(id);
const messages = $('messages');
let partialBubble = null;
let mode = 'demo';
let live = null;

function setText(id, text) { $(id).textContent = text; }
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function addMessage(role, text, replacePartial = false) {
  if (replacePartial && partialBubble) {
    partialBubble.querySelector('.body').textContent = text;
    partialBubble = null;
    return;
  }
  const item = document.createElement('div');
  item.className = `message ${role}`;
  item.innerHTML = `<span class="role">${role === 'user' ? 'You' : 'Nova'}</span><span class="body"></span>`;
  item.querySelector('.body').textContent = text;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function updatePartialAssistant(text) {
  if (!partialBubble) {
    partialBubble = document.createElement('div');
    partialBubble.className = 'message assistant';
    partialBubble.innerHTML = '<span class="role">Nova</span><span class="body"></span>';
    messages.appendChild(partialBubble);
  }
  partialBubble.querySelector('.body').textContent = text;
  messages.scrollTop = messages.scrollHeight;
}

const scene = new SpatialScene($('scene'), {
  onFocusChanged(id) {
    setText('focus-target', id ?? 'none');
    live?.pushSceneContext();
  },
  onStateChanged(state) { setText('agent-state', state); },
  onTool(name, args) { setText('last-tool', `${name}(${args.targetId ?? ''})`); },
  onTargetActivated(id) { toast(`Spatial target: ${id}`); },
});

const demo = new DemoCompanion({
  scene,
  onMessage: addMessage,
  onTool: (name, args) => setText('last-tool', `${name}(${args.targetId ?? ''})`),
  onStatus: status => setText('transport-state', status),
});

function setMode(nextMode) {
  mode = nextMode;
  setText('mode-pill', nextMode === 'live' ? 'Live AI' : 'Demo mode');
  $('mode-pill').classList.toggle('muted', false);
}

function liveStatus(status, error) {
  setText('transport-state', status);
  const pill = $('connection-pill');
  if (status === 'connected' || status === 'listening' || status === 'thinking' || status === 'speaking') {
    pill.textContent = status;
    pill.classList.remove('muted');
  } else {
    pill.textContent = status;
    pill.classList.add('muted');
  }
  if (error) toast(error);
}

async function connectLive() {
  const button = $('live-button');
  button.disabled = true;
  button.textContent = 'Connecting…';
  try {
    live = new RealtimeCompanion({
      audioElement: $('remote-audio'),
      scene,
      onStatus: liveStatus,
      onMessage: addMessage,
      onPartialAssistant: updatePartialAssistant,
      onTool: (name, args) => setText('last-tool', `${name}(${args.targetId ?? ''})`),
    });
    await live.connect();
    setMode('live');
    button.textContent = 'Live AI connected';
    toast('Microphone connected to realtime AI');
  } catch (error) {
    console.error(error);
    live?.disconnect();
    live = null;
    setMode('demo');
    liveStatus('offline', error.message.includes('404') ? 'Live backend is not deployed here. Demo mode still works.' : error.message);
    button.textContent = 'Connect Live AI';
    button.disabled = false;
  }
}

async function sendPrompt(text) {
  text = text.trim();
  if (!text) return;
  $('text-input').value = '';
  if (mode === 'live' && live?.connected) live.sendText(text);
  else await demo.respond(text);
}

$('live-button').addEventListener('click', connectLive);
$('demo-button').addEventListener('click', () => demo.runGuidedDemo());
$('send-button').addEventListener('click', () => sendPrompt($('text-input').value));
$('text-input').addEventListener('keydown', event => {
  if (event.key === 'Enter') sendPrompt(event.currentTarget.value);
});
document.querySelectorAll('[data-prompt]').forEach(button => {
  button.addEventListener('click', () => sendPrompt(button.dataset.prompt));
});

async function setupXRButton() {
  if (!navigator.xr) return;
  const [arSupported, vrSupported] = await Promise.all([
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
  ]);
  if (!arSupported && !vrSupported) return;
  const button = $('xr-button');
  button.classList.remove('hidden');
  button.addEventListener('click', async () => {
    try {
      const xrMode = await scene.enterXR();
      toast(`Entered ${xrMode}`);
    } catch (error) {
      toast(error.message);
    }
  });
}
setupXRButton();

addMessage('assistant', 'Hi. I am Nova. Look at the demo device and ask me what to do, or run the guided demo.');
