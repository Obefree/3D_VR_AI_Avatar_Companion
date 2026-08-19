(() => {
  const canvas = document.getElementById('scene');
  if (!canvas) return;

  let down = null;
  let lastTriggered = { id: null, at: 0 };

  function triggerPromptForTarget(id) {
    if (!id || id === 'none') return;

    const now = Date.now();
    if (lastTriggered.id === id && now - lastTriggered.at < 650) return;
    lastTriggered = { id, at: now };

    if (id === 'red_button') {
      const button = document.querySelector('[data-prompt="Show me the red button"]');
      button?.click();
      return;
    }

    if (id === 'filter') {
      const button = document.querySelector('[data-prompt="What should I do next?"]');
      button?.click();
      return;
    }

    if (id === 'device') {
      const input = document.getElementById('text-input');
      const send = document.getElementById('send-button');
      if (input && send) {
        input.value = 'Can you help me with this device?';
        send.click();
      }
    }
  }

  canvas.addEventListener('pointerdown', (event) => {
    down = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
    };
  }, true);

  canvas.addEventListener('pointerup', (event) => {
    if (!down || down.id !== event.pointerId) return;

    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    const elapsed = performance.now() - down.t;
    down = null;

    // Orbit / pinch gestures must not accidentally activate an object.
    if (moved > 12 || elapsed > 650) return;

    // SpatialScene updates #focus-target during its pointerup handler.
    // Wait one frame, then reuse the already-wired Nova command path.
    requestAnimationFrame(() => {
      const id = document.getElementById('focus-target')?.textContent?.trim();
      triggerPromptForTarget(id);
    });
  }, true);
})();
