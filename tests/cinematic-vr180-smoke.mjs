import assert from 'node:assert/strict';
import fs from 'node:fs';

const director = fs.readFileSync(new URL('../src/cinematic-director.js', import.meta.url), 'utf8');
const vr180 = fs.readFileSync(new URL('../src/vr180-recorder.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const embodiment = fs.readFileSync(new URL('../src/embodiment.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

assert.match(director, /CINEMATIC HUMANOID ACTOR DIRECTOR/, 'AI director prompt missing');
assert.match(director, /async function approachUser/, 'viewer-relative approach missing');
assert.match(director, /async function walkToTarget/, 'target locomotion missing');
assert.match(director, /async function pickUp/, 'prop pickup missing');
assert.match(director, /actor_window/, 'cinematic window target missing');
assert.match(director, /actor_glass/, 'cinematic prop target missing');
assert.match(director, /nova:cinematic-action/, 'cinematic action event missing');
assert.match(director, /LOCOMOTION_ACTIONS/, 'locomotion alias guard missing');
assert.match(director, /__NovaApp\?\.executeAction/, 'director does not reuse the app action dispatcher');
assert.match(director, /cinematic-director-toggle/, 'collapsible director toggle missing');
assert.match(director, /waitForChatIdle/, 'director does not wait for chat before running');
assert.match(director, /collapseConsecutive/, 'consecutive duplicate action collapse missing');

assert.match(vr180, /equirectangular-180/, 'VR180 projection metadata missing');
assert.match(vr180, /stereoLayout: 'left-right'/, 'LR SBS stereo layout missing');
assert.match(vr180, /eyeSeparationMeters: 0\.064/, '64 mm stereo baseline missing');
assert.match(vr180, /captureStream\(preset\.fps\)/, 'browser VR180 recording missing');
assert.match(vr180, /4096.*2048.*30/s, '4K draft preset missing');
assert.match(vr180, /5760.*2880.*48/s, 'Quest HQ preset missing');

assert.match(index, /src\/humanoid-avatar\.js/, 'humanoid main missing');
assert.match(index, /src\/cinematic-director\.js/, 'cinematic director not loaded');
assert.match(index, /src\/vr180-recorder\.js/, 'VR180 recorder not loaded');
assert.equal(index.includes('__NOVA_PRIMARY_FETCH'), false, 'PRIMARY_FETCH papering reintroduced');

assert.equal(/window\.fetch\s*=/.test(embodiment), false, 'embodiment fetch interceptor reintroduced');
assert.match(app, /executeAction,/, 'app dispatcher is not exported');
assert.match(app, /waitWhileDirectorRunning/, 'chat does not wait while the director runs');
assert.equal(fs.existsSync(new URL('./e2e.mjs', import.meta.url)), false, 'legacy e2e.mjs duplicate remains');

console.log('cinematic director + VR180 smoke: ok');
