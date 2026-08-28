import assert from 'node:assert/strict';
import fs from 'node:fs';

const director = fs.readFileSync(new URL('../src/cinematic-director.js', import.meta.url), 'utf8');
const vr180 = fs.readFileSync(new URL('../src/vr180-recorder.js', import.meta.url), 'utf8');
const embodiment = fs.readFileSync(new URL('../src/embodiment.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scene = fs.readFileSync(new URL('../src/scene.js', import.meta.url), 'utf8');

assert.match(director, /CINEMATIC HUMANOID ACTOR DIRECTOR/, 'AI director prompt missing');
assert.match(director, /async function approachUser/, 'viewer-relative approach missing');
assert.match(director, /async function walkToTarget/, 'target locomotion missing');
assert.match(director, /async function pickUp/, 'prop pickup missing');
assert.match(director, /actor_window/, 'cinematic window target missing');
assert.match(director, /actor_glass/, 'cinematic prop target missing');
assert.match(director, /nova:cinematic-action/, 'cinematic action event missing');
assert.match(director, /__NovaApp\.executeAction/, 'shared cinematic actions must use the chat dispatcher');
assert.match(director, /function collapseLocomotion/, 'duplicate locomotion collapse missing');
assert.match(director, /cinematicRunning|Director-only|via: 'app'/, 'dispatcher provenance missing');
assert.match(app, /executeAction,/, 'NovaApp must expose executeAction');
assert.match(app, /cinematicRunning/, 'chat must wait while a cinematic scene runs');
assert.match(scene, /this\.body\?\.visible/, 'hidden robot idle bob must be skipped');
assert.doesNotMatch(embodiment, /url\.includes\('nova-chat'\)/, 'embodiment must not replay extendedActions via fetch');
assert.doesNotMatch(embodiment, /window\.fetch = async/, 'embodiment must not intercept fetch');
assert.doesNotMatch(index, /__NOVA_PRIMARY_FETCH/, 'PRIMARY_FETCH workaround must stay gone');
assert.equal(fs.existsSync(new URL('./e2e.mjs', import.meta.url)), false, 'unused e2e.mjs duplicate must stay deleted');

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
assert.match(index, /src\/vr180-recorder\.js/, 'VR180 recorder not loaded');

console.log('cinematic director + VR180 + dispatcher smoke: ok');
