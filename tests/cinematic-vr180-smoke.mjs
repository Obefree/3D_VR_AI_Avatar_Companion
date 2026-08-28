import assert from 'node:assert/strict';
import fs from 'node:fs';

const director = fs.readFileSync(new URL('../src/cinematic-director.js', import.meta.url), 'utf8');
const vr180 = fs.readFileSync(new URL('../src/vr180-recorder.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(director, /CINEMATIC HUMANOID ACTOR DIRECTOR/, 'AI director prompt missing');
assert.match(director, /async function approachUser/, 'viewer-relative approach missing');
assert.match(director, /async function walkToTarget/, 'target locomotion missing');
assert.match(director, /async function pickUp/, 'prop pickup missing');
assert.match(director, /actor_window/, 'cinematic window target missing');
assert.match(director, /actor_glass/, 'cinematic prop target missing');
assert.match(director, /nova:cinematic-action/, 'cinematic action event missing');
assert.match(director, /__NovaApp\?\.executeAction/, 'director must reuse the chat action dispatcher');
assert.match(director, /pointer-events:none/, 'director overlay must not steal canvas gestures');
assert.match(director, /cinematic-director collapsed/, 'director must start collapsed');

assert.match(vr180, /equirectangular-180/, 'VR180 projection metadata missing');
assert.match(vr180, /stereoLayout: 'left-right'/, 'LR SBS stereo layout missing');
assert.match(vr180, /canon:.*0\.060/s, 'Canon 60 mm stereo baseline missing');
assert.match(vr180, /natural:.*0\.064/s, '64 mm headset stereo baseline missing');
assert.match(vr180, /captureStream\(preset\.fps\)/, 'browser VR180 recording missing');
assert.match(vr180, /getDisplayMedia/, 'optional tab audio capture missing');
assert.match(vr180, /tabAudioCaptured/, 'audio capture metadata missing');
assert.match(vr180, /4096.*2048.*30/s, '4K draft preset missing');
assert.match(vr180, /5760.*2880.*48/s, 'Quest HQ preset missing');

assert.match(index, /src\/humanoid-avatar\.js/, 'humanoid main missing');
assert.match(index, /src\/cinematic-director\.js/, 'cinematic director not loaded');
assert.equal(index.includes('__NOVA_PRIMARY_FETCH'), false, 'stale PRIMARY_FETCH fetch restore is still loaded');
assert.equal(fs.readFileSync(new URL('../src/embodiment.js', import.meta.url), 'utf8').includes('window.fetch ='), false, 'embodiment still wraps fetch beside app.js');
assert.match(index, /src\/vr180-recorder\.js/, 'VR180 recorder not loaded');

console.log('cinematic director + VR180 + audio smoke: ok');
