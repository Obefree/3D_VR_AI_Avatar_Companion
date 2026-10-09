import assert from 'node:assert/strict';
import { tvDemoPack } from '../scenario/packs/tv-demo.mjs';

const pack = tvDemoPack();
assert.equal(pack.pack, 'tv-demo');
assert.equal(pack.characters[0].name, 'Mara Vale');
assert.ok(pack.world.objects.some((o) => o.id === 'actor_window'));
assert.ok(pack.world.objects.some((o) => o.id === 'actor_glass'));
assert.ok(pack.world.objects.some((o) => o.id === 'actor_chair'));
assert.ok(!/готово/i.test(pack.characters[0].openingSeed || ''));
assert.ok((pack.characters[0].scenario?.beats || []).length > 0);

console.log('tv-demo smoke: ok', pack.world.objects.map((o) => o.id).join(' › '));
