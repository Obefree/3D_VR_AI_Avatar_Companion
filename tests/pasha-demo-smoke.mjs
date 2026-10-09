import assert from 'node:assert/strict';
import { pashaDemoPack } from '../scenario/packs/pasha-demo.mjs';

const pack = pashaDemoPack();
assert.equal(pack.pack, 'pasha-demo');
assert.equal(pack.characters[0].name, 'Mara Vale');
assert.ok(pack.world.objects.some((o) => o.id === 'actor_window'));
assert.ok(pack.world.objects.some((o) => o.id === 'actor_glass'));
assert.ok(pack.world.objects.some((o) => o.id === 'actor_chair'));
assert.notEqual(pack.how, 'pasha-checklist');

console.log('pasha-demo smoke: ok', pack.world.objects.map((o) => o.id).join(' › '));
