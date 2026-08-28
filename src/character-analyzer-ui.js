(() => {
  let lastAnalysis = null;

  function installStyles() {
    if (document.getElementById('nova-character-analysis-styles')) return;
    const style = document.createElement('style');
    style.id = 'nova-character-analysis-styles';
    style.textContent = `
      .nova-character-analysis{display:none;margin:10px 0;padding:11px;border:1px solid rgba(255,255,255,.12);border-radius:11px;background:rgba(255,255,255,.035)}
      .nova-character-analysis.visible{display:block}.nova-character-analysis h3{margin:0 0 7px;font-size:13px}.nova-character-analysis-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-bottom:8px}.nova-character-analysis-grid>div{padding:7px;border-radius:8px;background:rgba(255,255,255,.045)}.nova-character-analysis small{display:block;color:#8295a9;margin-bottom:2px}.nova-character-analysis strong{font-size:12px}.nova-character-analysis pre{white-space:pre-wrap;word-break:break-word;margin:8px 0 0;color:#b9c8d8;font:11px/1.45 system-ui,sans-serif}.nova-character-analysis-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:9px}.nova-character-analysis-actions button{border:1px solid rgba(255,255,255,.15);border-radius:9px;background:#1c2d42;color:#fff;padding:7px 10px;cursor:pointer}.nova-character-analysis-actions .applied{background:#245e43}.nova-analysis-traits{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.nova-analysis-traits span{padding:4px 6px;border-radius:7px;background:rgba(95,159,238,.11);color:#bbd9ff;font-size:10px}@media(max-width:680px){.nova-character-analysis-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function nativeAnimations() {
    const names = window.__novaHumanoid?.getState?.().animationNames || [];
    const cleaned = names.map((name) => String(name).split('|').pop()).filter(Boolean);
    const useful = ['Idle', 'Walk', 'Run', 'Wave', 'Interact', 'Kick_Left', 'Kick_Right', 'Punch_Left', 'Punch_Right', 'Roll']
      .filter((name) => cleaned.includes(name));
    return useful.length ? useful : cleaned.slice(0, 10);
  }

  function percent(value) {
    return `${Math.round((Number(value) || 0) * 100)}%`;
  }

  function render(analysis) {
    lastAnalysis = analysis;
    const box = document.getElementById('nova-character-analysis');
    if (!box) return;
    box.classList.add('visible');
    box.querySelector('[data-field="role"]').textContent = analysis.role || '—';
    box.querySelector('[data-field="archetype"]').textContent = analysis.archetype || '—';
    box.querySelector('[data-field="relationship"]').textContent = analysis.relationship || '—';
    const traits = analysis.traits || {};
    box.querySelector('.nova-analysis-traits').innerHTML = Object.entries(traits)
      .map(([key, value]) => `<span>${key}: ${percent(value)}</span>`).join('');
    const moves = analysis.movement?.vocabulary?.map((item) => `${item.name}${item.count > 1 ? ` ×${item.count}` : ''}`).join(', ') || '—';
    const goals = analysis.goals?.map((goal) => `• ${goal}`).join('\n') || '—';
    const speech = analysis.speech || {};
    const dialogue = analysis.dialogueExamples?.slice(0, 4).map((line) => `“${line}”`).join('  ') || '—';
    const native = nativeAnimations().join(', ') || '—';
    box.querySelector('pre').textContent = [
      `Goals:\n${goals}`,
      `\nInferred movement: ${moves}`,
      `Speech: ${speech.style || '—'} · ${speech.tempo || '—'}`,
      `Dialogue examples: ${dialogue}`,
      `Model native clips: ${native}`,
      `Analysis source: ${analysis.source || 'local'}`,
    ].join('\n');
    const apply = box.querySelector('#nova-apply-character-analysis');
    apply.disabled = false;
    apply.textContent = 'Apply to Nova';
    apply.classList.remove('applied');
  }

  function setScenarioStatus(text) {
    const node = document.getElementById('nova-scenario-status');
    if (node) node.textContent = text;
  }

  async function analyzeCurrentScenario(useAi = true) {
    const script = document.getElementById('nova-scenario-script')?.value || '';
    if (!script.trim()) throw new Error('Scenario is empty');
    if (!window.__novaCharacterAnalyzer?.analyze) throw new Error('Character analyzer is not ready');
    setScenarioStatus('Analyzing character…');
    const analysis = await window.__novaCharacterAnalyzer.analyze(script, { ai: useAi });
    render(analysis);
    setScenarioStatus(`Character identified · ${analysis.source}`);
    return analysis;
  }

  function install() {
    installStyles();
    const modal = document.getElementById('nova-scenario-modal');
    if (!modal || document.getElementById('nova-analyze-character')) return false;
    const buttons = modal.querySelector('.nova-scenario-buttons');
    const characterButton = modal.querySelector('#nova-scenario-character');
    if (!buttons) return false;

    const analyze = document.createElement('button');
    analyze.id = 'nova-analyze-character';
    analyze.type = 'button';
    analyze.textContent = 'Analyze character';
    const analyzeLocal = document.createElement('button');
    analyzeLocal.id = 'nova-analyze-character-local';
    analyzeLocal.type = 'button';
    analyzeLocal.textContent = 'Analyze locally';
    if (characterButton) {
      buttons.insertBefore(analyze, characterButton);
      buttons.insertBefore(analyzeLocal, characterButton);
    } else {
      buttons.appendChild(analyze);
      buttons.appendChild(analyzeLocal);
    }

    const box = document.createElement('section');
    box.id = 'nova-character-analysis';
    box.className = 'nova-character-analysis';
    box.innerHTML = `
      <h3>Character extracted from scenario</h3>
      <div class="nova-character-analysis-grid">
        <div><small>Role</small><strong data-field="role">—</strong></div>
        <div><small>Archetype</small><strong data-field="archetype">—</strong></div>
        <div><small>Relationship</small><strong data-field="relationship">—</strong></div>
      </div>
      <div class="nova-analysis-traits"></div>
      <pre></pre>
      <div class="nova-character-analysis-actions">
        <button id="nova-apply-character-analysis" type="button" disabled>Apply to Nova</button>
      </div>`;
    const status = modal.querySelector('#nova-scenario-status');
    status?.parentNode?.insertBefore(box, status.nextSibling);

    analyze.addEventListener('click', async () => {
      analyze.disabled = true;
      try { await analyzeCurrentScenario(true); }
      catch (error) { setScenarioStatus(`Character analysis error: ${error?.message || error}`); }
      finally { analyze.disabled = false; }
    });

    analyzeLocal.addEventListener('click', async () => {
      analyzeLocal.disabled = true;
      try { await analyzeCurrentScenario(false); }
      catch (error) { setScenarioStatus(`Character analysis error: ${error?.message || error}`); }
      finally { analyzeLocal.disabled = false; }
    });

    box.querySelector('#nova-apply-character-analysis').addEventListener('click', (event) => {
      if (!lastAnalysis) return;
      window.__novaCharacterAnalyzer.apply(lastAnalysis);
      const button = event.currentTarget;
      button.textContent = 'Applied ✓';
      button.classList.add('applied');
      setScenarioStatus('Character profile updated from scenario');
    });
    return true;
  }

  function boot() {
    if (install()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts > 160) clearInterval(timer);
    }, 50);
  }

  window.__novaCharacterAnalyzerUI = { install, analyzeCurrentScenario, show: render, getLastAnalysis: () => lastAnalysis };
  window.addEventListener('DOMContentLoaded', boot);
})();
