import assert from 'node:assert/strict';
import fs from 'node:fs';

const actor = fs.readFileSync(new URL('../src/actor-director.js', import.meta.url), 'utf8');
const humanoid = fs.readFileSync(new URL('../src/humanoid-actor.js', import.meta.url), 'utf8');
const vr180 = fs.readFileSync(new URL('../src/vr180-recorder.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(actor, /async function compileWithAI\(/, 'AI director compiler is missing');
assert.match(actor, /async function runScript\(/, 'actor script runner is missing');
assert.match(actor, /new THREE\.StereoCamera\(\)/, 'stereo camera preview is missing');
assert.match(actor, /stereo\.eyeSep = 0\.064/, 'stereo baseline must be 64 mm');
assert.match(actor, /approach_user/, 'viewer-relative actor movement is missing');
assert.match(actor, /actor_glass/, 'cinematic prop target is missing');

assert.match(humanoid, /GLTFLoader/, 'rigged GLB humanoid loader is missing');
assert.match(humanoid, /SkeletonUtils\.retargetClip/, 'animation retargeting is missing');
assert.match(humanoid, /Idle.*Walk.*Run/s, 'locomotion clip support is missing');
assert.match(humanoid, /TARGET_HEIGHT = 1\.72/, 'humanoid normalization is missing');
assert.match(humanoid, /__novaHumanoidActorReady/, 'humanoid readiness contract is missing');

assert.match(vr180, /equirectangular-180/, 'VR180 projection metadata is missing');
assert.match(vr180, /stereoLayout: 'left-right'/, 'VR180 SBS layout is missing');
assert.match(vr180, /eyeSeparationMeters: 0\.064/, 'VR180 64mm IPD metadata is missing');
assert.match(vr180, /captureStream\(preset\.fps\)/, 'VR180 browser video capture is missing');
assert.match(vr180, /5760.*2880.*48/s, 'Quest HQ preset is missing');

assert.match(index, /src\/actor-director\.js/, 'actor director module is not loaded');
assert.match(index, /src\/humanoid-actor\.js/, 'humanoid actor module is not loaded');
assert.match(index, /src\/vr180-recorder\.js/, 'VR180 recorder module is not loaded');

console.log('actor-director + humanoid + VR180 smoke: ok');
