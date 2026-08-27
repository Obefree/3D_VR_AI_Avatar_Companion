import assert from 'node:assert/strict';
import fs from 'node:fs';

const actor = fs.readFileSync(new URL('../src/actor-director.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(actor, /async function compileWithAI\(/, 'AI director compiler is missing');
assert.match(actor, /async function runScript\(/, 'actor script runner is missing');
assert.match(actor, /new THREE\.StereoCamera\(\)/, 'stereo camera preview is missing');
assert.match(actor, /stereo\.eyeSep = 0\.064/, 'stereo baseline must be 64 mm');
assert.match(actor, /approach_user/, 'viewer-relative actor movement is missing');
assert.match(actor, /actor_glass/, 'cinematic prop target is missing');
assert.match(actor, /installFemaleActorSkin/, 'female actor skin is missing');
assert.match(index, /src\/actor-director\.js/, 'actor director module is not loaded by index.html');

console.log('actor-director smoke: ok');
