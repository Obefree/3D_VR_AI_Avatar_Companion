(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let enabled = false;

  function hideLegacySceneProps(scene) {
    if (!scene) return;
    if (scene.device) scene.device.visible = false;
    if (scene.environmentGroup?.children?.length) {
      // Keep the floor, remove the diagnostic grid and old service pedestal.
      scene.environmentGroup.children.forEach((child, index) => { if (index > 0) child.visible = false; });
    }
    for (const [id, target] of scene.targets || []) {
      if (String(id).startsWith('user_') && target?.mesh) target.mesh.visible = false;
    }
  }

  function injectStyle() {
    if (document.getElementById('cinematic-presentation-style')) return;
    const style = document.createElement('style');
    style.id = 'cinematic-presentation-style';
    style.textContent = `
      #cinematic-present-toggle { background:rgba(255,255,255,.11); }
      #cinematic-show-controls { display:none; position:fixed; right:14px; top:14px; z-index:70; border:1px solid rgba(255,255,255,.2); border-radius:10px; background:rgba(7,11,18,.72); color:#fff; padding:8px 11px; cursor:pointer; backdrop-filter:blur(10px); }
      html.cinematic-presentation .topbar,
      html.cinematic-presentation .controls,
      html.cinematic-presentation .dev-panel,
      html.cinematic-presentation .transcript,
      html.cinematic-presentation #crosshair,
      html.cinematic-presentation #cinematic-director { display:none !important; }
      html.cinematic-presentation #cinematic-show-controls { display:block; }
    `;
    document.head.appendChild(style);
  }

  function setPresentation(value) {
    enabled = Boolean(value);
    document.documentElement.classList.toggle('cinematic-presentation', enabled);
    const button = document.getElementById('cinematic-present-toggle');
    if (button) button.textContent = enabled ? 'Exit presentation' : 'Presentation mode';
    window.dispatchEvent(new CustomEvent('nova:presentation-mode', { detail: { enabled } }));
  }

  async function init() {
    injectStyle();
    for (let i = 0; i < 160; i += 1) {
      const scene = window.__novaScene;
      const panel = document.getElementById('cinematic-director');
      if (scene?.scene && panel) {
        hideLegacySceneProps(scene);
        const row = panel.querySelector('.row') || panel;
        const button = document.createElement('button');
        button.id = 'cinematic-present-toggle';
        button.type = 'button';
        button.textContent = 'Presentation mode';
        button.addEventListener('click', () => setPresentation(true));
        row.appendChild(button);

        const restore = document.createElement('button');
        restore.id = 'cinematic-show-controls';
        restore.type = 'button';
        restore.textContent = 'Show controls';
        restore.addEventListener('click', () => setPresentation(false));
        document.body.appendChild(restore);

        window.__novaPresentation = {
          enable: () => setPresentation(true),
          disable: () => setPresentation(false),
          toggle: () => setPresentation(!enabled),
          get enabled() { return enabled; },
        };
        return;
      }
      await sleep(75);
    }
    console.warn('Presentation mode could not attach to cinematic UI');
  }

  void init();
})();
