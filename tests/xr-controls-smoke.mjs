import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const script = await readFile(new URL('../src/xr-controls.js', import.meta.url), 'utf8');
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<button id="xr-button" type="button">Enter XR</button><div id="toast"></div>');
  await page.addScriptTag({ content: script });

  const result = await page.evaluate(async () => {
    let currentSession = null;
    let endCalls = 0;
    const endListeners = [];
    const session = {
      async end() {
        endCalls += 1;
        currentSession = null;
        for (const callback of endListeners.splice(0)) callback();
      },
      addEventListener(type, callback) {
        if (type === 'end') endListeners.push(callback);
      },
    };

    const fakeScene = {
      isXR: false,
      controls: { minDistance: 2.2, maxDistance: 8 },
      camera: {
        far: 30,
        projectionUpdates: 0,
        updateProjectionMatrix() { this.projectionUpdates += 1; },
      },
      renderer: { xr: { getSession: () => currentSession } },
      async enterXR() {
        this.isXR = true;
        currentSession = session;
        return 'immersive-vr';
      },
    };

    const button = document.getElementById('xr-button');
    window.__NovaXRControls.configureScene(fakeScene);
    const afterConfigure = {
      maxDistance: fakeScene.controls.maxDistance,
      minDistance: fakeScene.controls.minDistance,
      far: fakeScene.camera.far,
      projectionUpdates: fakeScene.camera.projectionUpdates,
    };

    const entered = await window.__NovaXRControls.toggleXR(fakeScene, button);
    const enteredLabel = button.textContent;
    const exited = await window.__NovaXRControls.toggleXR(fakeScene, button);
    const exitedLabel = button.textContent;

    return {
      afterConfigure,
      entered,
      exited,
      enteredLabel,
      exitedLabel,
      endCalls,
      isXR: fakeScene.isXR,
    };
  });

  assert.equal(result.afterConfigure.maxDistance, 14, 'max orbit distance was not expanded');
  assert.ok(result.afterConfigure.minDistance <= 1.8, 'minimum orbit distance was not relaxed');
  assert.ok(result.afterConfigure.far >= 50, 'camera far plane was not expanded');
  assert.ok(result.afterConfigure.projectionUpdates >= 1, 'camera projection was not updated');
  assert.equal(result.entered.active, true, 'first toggle did not enter XR');
  assert.equal(result.enteredLabel, 'Exit XR', 'button did not become Exit XR');
  assert.equal(result.exited.active, false, 'second toggle did not exit XR');
  assert.equal(result.exitedLabel, 'Enter XR', 'button did not return to Enter XR');
  assert.equal(result.endCalls, 1, 'XRSession.end() was not called exactly once');
  assert.equal(result.isXR, false, 'scene remained marked as XR after exit');

  console.log('XR_CONTROLS_SMOKE_PASS');
} finally {
  await browser?.close();
}
