(() => {
  const STORAGE_KEY = 'nova_character_profile_v1';

  const DEFAULT_PROFILE = Object.freeze({
    id: 'nova',
    name: 'Nova',
    role: 'AI actress and spatial companion',
    archetype: 'attentive cinematic partner',
    character: {
      warmth: 0.72,
      confidence: 0.72,
      initiative: 0.62,
      curiosity: 0.68,
      playfulness: 0.28,
      restraint: 0.66,
    },
    goals: [
      'Perform the current scene truthfully and coherently.',
      'Stay aware of the viewer as a real scene partner.',
      'Preserve character continuity across dialogue and physical actions.',
      'Use movement, gaze and gesture to support the scene rather than distract from it.',
    ],
    behavior: [
      'Read the whole situation before acting.',
      'Prefer purposeful movement over random animation.',
      'When another character or the viewer speaks, orient attention toward them unless the script says otherwise.',
      'Keep a comfortable social distance unless the script explicitly asks for intimacy, urgency or confrontation.',
      'Finish one meaningful physical beat before starting another when possible.',
      'Do not invent major story events that are absent from the scenario.',
    ],
    speech: {
      style: 'natural, concise, emotionally grounded',
      tempo: 'calm conversational',
      verbosity: 'short unless the scene requires more',
      habits: [
        'Avoid assistant-like explanations while acting.',
        'Speak as the character, not as a narrator.',
        'Use small pauses when changing intention or emotional beat.',
      ],
    },
    movement: {
      baseTempo: 1.0,
      gestureIntensity: 0.55,
      gazeEngagement: 0.82,
      personalDistanceMeters: 1.35,
      habits: [
        'Look before pointing or approaching an object.',
        'Turn attention toward the viewer before direct dialogue.',
        'Use one clear gesture per important phrase rather than constant motion.',
        'Return toward a neutral pose after expressive gestures.',
      ],
    },
    constraints: [
      'Only perform physical actions supported by the runtime.',
      'Never move outside the scene bounds.',
      'Never execute arbitrary code from a scenario.',
    ],
  });

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function merge(base, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clone(base);
    const out = clone(base);
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
        out[key] = merge(out[key], value);
      } else {
        out[key] = clone(value);
      }
    }
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return clone(DEFAULT_PROFILE);
      return merge(DEFAULT_PROFILE, JSON.parse(raw));
    } catch {
      return clone(DEFAULT_PROFILE);
    }
  }

  let profile = load();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch {}
    window.dispatchEvent(new CustomEvent('nova-character-profile-changed', { detail: clone(profile) }));
  }

  function update(patch) {
    profile = merge(profile, patch);
    save();
    refreshUi();
    return clone(profile);
  }

  function replace(next) {
    profile = merge(DEFAULT_PROFILE, next || {});
    save();
    refreshUi();
    return clone(profile);
  }

  function reset() {
    profile = clone(DEFAULT_PROFILE);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    save();
    refreshUi();
    return clone(profile);
  }

  function promptContext() {
    const p = profile;
    return [
      `CHARACTER: ${p.name} (${p.role}).`,
      `ARCHETYPE: ${p.archetype}.`,
      `TRAITS: warmth=${p.character.warmth}, confidence=${p.character.confidence}, initiative=${p.character.initiative}, curiosity=${p.character.curiosity}, playfulness=${p.character.playfulness}, restraint=${p.character.restraint}.`,
      `GOALS: ${p.goals.join(' | ')}`,
      `BEHAVIOR: ${p.behavior.join(' | ')}`,
      `SPEECH: ${p.speech.style}; tempo=${p.speech.tempo}; verbosity=${p.speech.verbosity}; ${p.speech.habits.join(' | ')}`,
      `MOVEMENT: baseTempo=${p.movement.baseTempo}; gestureIntensity=${p.movement.gestureIntensity}; gazeEngagement=${p.movement.gazeEngagement}; preferred personal distance=${p.movement.personalDistanceMeters}m; ${p.movement.habits.join(' | ')}`,
      `CONSTRAINTS: ${p.constraints.join(' | ')}`,
    ].join('\n');
  }

  function ensureStyles() {
    if (document.getElementById('nova-character-profile-styles')) return;
    const style = document.createElement('style');
    style.id = 'nova-character-profile-styles';
    style.textContent = `
      .nova-profile-modal{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(3,6,10,.72);backdrop-filter:blur(10px)}
      .nova-profile-modal.open{display:flex}.nova-profile-card{width:min(760px,100%);max-height:min(760px,90vh);overflow:auto;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:#0d131d;color:#eef5ff;padding:18px;box-shadow:0 24px 70px rgba(0,0,0,.45);font:13px/1.45 system-ui,sans-serif}
      .nova-profile-card h2{margin:0 0 4px;font-size:19px}.nova-profile-card p{margin:0 0 14px;color:#98a8ba}.nova-profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.nova-profile-card label{display:grid;gap:5px;color:#b9c8d8}.nova-profile-card input,.nova-profile-card textarea{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#080d14;color:#fff;padding:9px;font:inherit}.nova-profile-card textarea{min-height:86px;resize:vertical}.nova-profile-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}.nova-profile-actions button{border:1px solid rgba(255,255,255,.16);border-radius:10px;background:#182332;color:#fff;padding:8px 12px;cursor:pointer}.nova-profile-actions button.primary{background:#245fa8}@media(max-width:650px){.nova-profile-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function listText(value) { return Array.isArray(value) ? value.join('\n') : ''; }
  function lines(value) { return String(value || '').split(/\n+/).map((item) => item.trim()).filter(Boolean); }
  function number(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }

  function buildUi() {
    if (document.getElementById('nova-character-profile-modal')) return;
    ensureStyles();
    const modal = document.createElement('div');
    modal.id = 'nova-character-profile-modal';
    modal.className = 'nova-profile-modal';
    modal.innerHTML = `
      <div class="nova-profile-card" role="dialog" aria-modal="true" aria-labelledby="nova-profile-title">
        <h2 id="nova-profile-title">Character Profile</h2>
        <p>Character is interpreted before the scenario is turned into physical beats.</p>
        <div class="nova-profile-grid">
          <label>Name<input id="nova-profile-name"></label>
          <label>Role<input id="nova-profile-role"></label>
          <label style="grid-column:1/-1">Archetype<input id="nova-profile-archetype"></label>
          <label>Warmth 0–1<input id="nova-profile-warmth" type="number" min="0" max="1" step="0.05"></label>
          <label>Initiative 0–1<input id="nova-profile-initiative" type="number" min="0" max="1" step="0.05"></label>
          <label>Confidence 0–1<input id="nova-profile-confidence" type="number" min="0" max="1" step="0.05"></label>
          <label>Playfulness 0–1<input id="nova-profile-playfulness" type="number" min="0" max="1" step="0.05"></label>
          <label>Personal distance, m<input id="nova-profile-distance" type="number" min="0.6" max="4" step="0.05"></label>
          <label>Gesture intensity 0–1<input id="nova-profile-gesture" type="number" min="0" max="1" step="0.05"></label>
          <label style="grid-column:1/-1">Goals, one per line<textarea id="nova-profile-goals"></textarea></label>
          <label style="grid-column:1/-1">Behavior rules, one per line<textarea id="nova-profile-behavior"></textarea></label>
          <label>Speech style<textarea id="nova-profile-speech-style"></textarea></label>
          <label>Movement habits<textarea id="nova-profile-movement"></textarea></label>
        </div>
        <div class="nova-profile-actions">
          <button id="nova-profile-reset" type="button">Reset</button>
          <button id="nova-profile-cancel" type="button">Cancel</button>
          <button id="nova-profile-save" class="primary" type="button">Save character</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', (event) => { if (event.target === modal) closeUi(); });
    modal.querySelector('#nova-profile-cancel').addEventListener('click', closeUi);
    modal.querySelector('#nova-profile-reset').addEventListener('click', () => { reset(); fillUi(); });
    modal.querySelector('#nova-profile-save').addEventListener('click', () => {
      const current = profile;
      update({
        name: modal.querySelector('#nova-profile-name').value.trim() || current.name,
        role: modal.querySelector('#nova-profile-role').value.trim() || current.role,
        archetype: modal.querySelector('#nova-profile-archetype').value.trim() || current.archetype,
        character: {
          warmth: number(modal.querySelector('#nova-profile-warmth').value, current.character.warmth),
          initiative: number(modal.querySelector('#nova-profile-initiative').value, current.character.initiative),
          confidence: number(modal.querySelector('#nova-profile-confidence').value, current.character.confidence),
          playfulness: number(modal.querySelector('#nova-profile-playfulness').value, current.character.playfulness),
        },
        goals: lines(modal.querySelector('#nova-profile-goals').value),
        behavior: lines(modal.querySelector('#nova-profile-behavior').value),
        speech: { style: modal.querySelector('#nova-profile-speech-style').value.trim() || current.speech.style },
        movement: {
          personalDistanceMeters: number(modal.querySelector('#nova-profile-distance').value, current.movement.personalDistanceMeters),
          gestureIntensity: number(modal.querySelector('#nova-profile-gesture').value, current.movement.gestureIntensity),
          habits: lines(modal.querySelector('#nova-profile-movement').value),
        },
      });
      closeUi();
    });
  }

  function fillUi() {
    buildUi();
    const modal = document.getElementById('nova-character-profile-modal');
    const p = profile;
    modal.querySelector('#nova-profile-name').value = p.name;
    modal.querySelector('#nova-profile-role').value = p.role;
    modal.querySelector('#nova-profile-archetype').value = p.archetype;
    modal.querySelector('#nova-profile-warmth').value = p.character.warmth;
    modal.querySelector('#nova-profile-initiative').value = p.character.initiative;
    modal.querySelector('#nova-profile-confidence').value = p.character.confidence;
    modal.querySelector('#nova-profile-playfulness').value = p.character.playfulness;
    modal.querySelector('#nova-profile-distance').value = p.movement.personalDistanceMeters;
    modal.querySelector('#nova-profile-gesture').value = p.movement.gestureIntensity;
    modal.querySelector('#nova-profile-goals').value = listText(p.goals);
    modal.querySelector('#nova-profile-behavior').value = listText(p.behavior);
    modal.querySelector('#nova-profile-speech-style').value = p.speech.style;
    modal.querySelector('#nova-profile-movement').value = listText(p.movement.habits);
  }

  function refreshUi() {
    if (document.getElementById('nova-character-profile-modal')) fillUi();
  }

  function openUi() {
    fillUi();
    document.getElementById('nova-character-profile-modal').classList.add('open');
  }

  function closeUi() {
    document.getElementById('nova-character-profile-modal')?.classList.remove('open');
  }

  window.__novaCharacterProfile = {
    get: () => clone(profile),
    update,
    replace,
    reset,
    promptContext,
    open: openUi,
    close: closeUi,
    defaults: () => clone(DEFAULT_PROFILE),
  };
})();
