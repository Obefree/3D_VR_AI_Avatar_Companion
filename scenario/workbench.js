import { parseScenario, fitWorldToCharacters } from './parse.mjs';

const PACK_KEY = 'nova-scenario-pack';
const FIELDS = [
  ['name', 'Имя / роль на сцене'],
  ['role', 'Роль'],
  ['pronoun', 'Местоимение'],
  ['meaning', 'Смысл в сцене'],
  ['want', 'Хочет сейчас'],
  ['forbidden', 'Не делает'],
  ['goals', 'Цели'],
  ['temperament', 'Характер'],
  ['speechManner', 'Речь'],
  ['movement', 'Движение'],
  ['appearance', 'Внешность'],
  ['relations', 'Связи'],
];

const state = { pack: emptyPack(), selected: 0 };

function emptyPack() {
  return { version: 1, source: '', characters: [], world: null };
}

function appearanceText(character) {
  const look = character?.appearance;
  if (!look) return '';
  if (typeof look === 'string') return look;
  return look.notes || '';
}

function asLine(value) {
  return Array.isArray(value) ? value.filter(Boolean).join('; ') : String(value || '');
}

function current() {
  return state.pack.characters[state.selected] || null;
}

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function renderRoster() {
  const host = document.getElementById('roster');
  const rows = state.pack.characters;
  if (!rows.length) {
    host.innerHTML = '<p class="hint">Пока никого. Разбери текст или добавь лицо вручную.</p>';
    return;
  }
  host.innerHTML = rows.map((item, index) => {
    const bits = [item.role, item.pronoun].filter(Boolean).join(' · ');
    return `<button type="button" class="card${index === state.selected ? ' active' : ''}" data-i="${index}">
      <strong>${item.name || 'без имени'}</strong>
      <span class="meta">${bits || 'черновик'}</span>
    </button>`;
  }).join('');
  host.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => {
      state.selected = Number(card.dataset.i);
      render();
    });
  });
}

function renderFields() {
  const host = document.getElementById('fields');
  const character = current();
  if (!character) {
    host.innerHTML = '<p class="hint">Нет выбранной карточки.</p>';
    return;
  }
  const values = {
    name: character.name || '',
    role: character.role || '',
    pronoun: character.pronoun || '',
    meaning: character.meaning || '',
    want: character.want || '',
    forbidden: character.forbidden || '',
    goals: asLine(character.goals),
    temperament: character.temperament || '',
    speechManner: character.speechManner || '',
    movement: character.movement || '',
    appearance: appearanceText(character),
    relations: asLine(character.relations),
  };
  host.innerHTML = FIELDS.map(([key, label]) => {
    const tall = ['meaning', 'want', 'forbidden', 'goals', 'temperament', 'speechManner', 'appearance'].includes(key);
    const body = tall
      ? `<textarea id="f-${key}" rows="3">${escapeHtml(values[key])}</textarea>`
      : `<input id="f-${key}" value="${escapeHtml(values[key])}" />`;
    return `<div><label for="f-${key}">${label}</label>${body}</div>`;
  }).join('');
  FIELDS.forEach(([key]) => {
    document.getElementById(`f-${key}`)?.addEventListener('input', (event) => writeField(key, event.target.value));
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function writeField(key, value) {
  const character = current();
  if (!character) return;
  if (key === 'goals' || key === 'relations') {
    character[key] = String(value || '').split(/[;,\n]/).map((item) => item.trim()).filter(Boolean);
    return;
  }
  if (key === 'appearance') {
    const notes = String(value || '').trim();
    character.appearance = notes ? { notes } : null;
    return;
  }
  character[key] = String(value || '').trim();
  if (key === 'name') renderRoster();
}

function render() {
  renderRoster();
  renderFields();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

async function readSourceFile(file) {
  const name = file.name || 'document';
  const ext = `.${String(name.split('.').pop() || '').toLowerCase()}`;
  const textLike = ['.txt', '.md', '.text', '.csv'].includes(ext) || String(file.type || '').startsWith('text/');
  if (textLike) return file.text();
  setStatus(`Читаю ${name}…`);
  const data = await fileToDataUrl(file);
  const res = await fetch('/api/extract-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mime: file.type, data }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error || `Файл не разобрался (${res.status})`);
  return String(json.text || '');
}

async function parseNow() {
  const source = document.getElementById('source').value;
  const parseBtn = document.getElementById('parse');
  if (parseBtn) parseBtn.disabled = true;
  try {
    const parsed = parseScenario(source);
    state.pack = parsed;
    state.selected = 0;
    const worldLine = describeWorld(parsed.world);
    setStatus(parsed.characters.length
      ? `Черновик: ${parsed.characters.length} лиц, ${worldLine}. Уточняю…`
      : 'В тексте пока нет явных имён — спрашиваю модель…');
    render();
    try {
      const res = await fetch('/api/parse-characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: source }),
        signal: AbortSignal.timeout(22000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && Array.isArray(data.characters) && data.characters.length) {
        state.pack = {
          version: 1,
          source,
          characters: data.characters,
          world: data.world || parsed.world,
          truncated: data.truncated,
          pack: data.pack || parsed.pack || '',
        };
        state.selected = 0;
        const tag = data.usedLlm ? 'модель' : 'черновик';
        setStatus(`Готово (${tag}): ${state.pack.characters.length} лиц, ${describeWorld(state.pack.world)}. Правь карточки — это источник для VR.`);
        render();
        return;
      }
      if (!parsed.characters.length) {
        setStatus(data.error || 'Не нашлись действующие лица. Нужны имена или роли в тексте (Принц, Анна, он сказал…). Или добавь лицо вручную.');
        return;
      }
    } catch (error) {
      if (!parsed.characters.length) {
        const timedOut = /TimeoutError|AbortError|aborted|timed out/i.test(String(error?.name || '') + String(error?.message || ''));
        setStatus(timedOut
          ? 'Модель не успела. Добавь лицо вручную или вставь реплики с именами («Маша сказала», «Принц:»).'
          : (error?.message || 'Сервер разбора недоступен.'));
        return;
      }
    }
    setStatus(`Черновик: ${parsed.characters.length} лиц, ${worldLine}. Правь карточки справа.`);
  } catch (error) {
    setStatus(error?.message || String(error));
  } finally {
    if (parseBtn) parseBtn.disabled = false;
  }
}

function describeWorld(world) {
  if (!world) return 'мир не собран';
  const n = (world.objects || []).length;
  return `${world.title || world.mood || 'мир'}: ${n} объектов`;
}

function addPerson() {
  state.pack.characters.push({
    name: 'Новое лицо',
    role: '',
    pronoun: '',
    aliases: [],
    meaning: '',
    goals: [],
    temperament: '',
    speechManner: '',
    movement: '',
    appearance: null,
    relations: [],
  });
  state.selected = state.pack.characters.length - 1;
  render();
}

function removePerson() {
  if (!current()) return;
  state.pack.characters.splice(state.selected, 1);
  state.selected = Math.max(0, state.selected - 1);
  render();
}

function savePack() {
  state.pack.source = document.getElementById('source').value;
  state.pack.version = 1;
  if (state.pack.characters?.length) {
    state.pack.world = fitWorldToCharacters(state.pack.world || { mood: 'apartment', objects: [] }, state.pack.characters);
  }
  localStorage.setItem(PACK_KEY, JSON.stringify(state.pack));
}

document.getElementById('parse').addEventListener('click', parseNow);
document.getElementById('add').addEventListener('click', addPerson);
document.getElementById('remove').addEventListener('click', removePerson);
document.getElementById('to-vr').addEventListener('click', () => {
  savePack();
  window.location.href = '/?pack=custom';
});
document.getElementById('download').addEventListener('click', () => {
  savePack();
  const blob = new Blob([JSON.stringify(state.pack, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'nova-scenario.json';
  link.click();
  URL.revokeObjectURL(url);
});
document.getElementById('file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await readSourceFile(file);
    document.getElementById('source').value = text;
    setStatus(`Загружен ${file.name}: ${text.length} знаков.`);
    await parseNow();
  } catch (error) {
    setStatus(error?.message || String(error));
  }
});

try {
  const raw = localStorage.getItem(PACK_KEY);
  if (raw) {
    const pack = JSON.parse(raw);
    if (pack?.characters) {
      state.pack = { ...emptyPack(), ...pack };
      document.getElementById('source').value = pack.source || '';
      setStatus('Открыт сохранённый пакет.');
    }
  }
} catch {}
render();
