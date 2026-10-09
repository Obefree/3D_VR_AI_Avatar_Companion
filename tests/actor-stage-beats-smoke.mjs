import assert from 'node:assert/strict';
import { littlePrinceDefaultPack } from '../scenario/packs/little-prince.mjs';
import { parseScenario } from '../scenario/parse.mjs';

/** Mirror of director beat ordering — keep in sync with cinematic-director orderBeatActions. */
function orderBeatActions(rawActions) {
  const order = ['face_user', 'look_at', 'point_at', 'walk_to', 'approach_user', 'wave', 'pick_up', 'speak'];
  const banned = new Set(['press_button', 'remove_filter', 'highlight']);
  const buckets = Object.fromEntries(order.map((name) => [name, null]));
  const ids = new Set(['planet_fox', 'fox_wheat', 'rose_on_home']);
  for (const item of rawActions || []) {
    if (!item?.name || banned.has(item.name) || !order.includes(item.name)) continue;
    const action = { name: item.name, args: { ...(item.args || {}) } };
    if (['look_at', 'point_at', 'walk_to'].includes(action.name)) {
      const raw = String(action.args.targetId || action.args.target || '').toLowerCase();
      action.args.targetId = [...ids].find((id) => id.includes(raw) || raw.includes(id)) || [...ids][0];
    }
    if (!buckets[action.name]) buckets[action.name] = action;
  }
  const body = order.filter((n) => n !== 'speak').map((n) => buckets[n]).filter(Boolean).slice(0, 3);
  const spoken = buckets.speak ? [buckets.speak] : [];
  return [...body, ...spoken];
}

const messy = [
  { name: 'speak', args: { text: 'Приручи меня.', as: 'self' } },
  { name: 'press_button', args: {} },
  { name: 'walk_to', args: { target: 'wheat' } },
  { name: 'look_at', args: { targetId: 'fox_wheat' } },
  { name: 'point_at', args: { targetId: 'planet_fox' } },
];
const ordered = orderBeatActions(messy);
assert.deepEqual(
  ordered.map((item) => item.name),
  ['look_at', 'point_at', 'walk_to', 'speak'],
);
assert.equal(ordered.find((item) => item.name === 'walk_to').args.targetId, 'fox_wheat');
assert.ok(!ordered.some((item) => item.name === 'press_button'));

const pack = littlePrinceDefaultPack();
assert.equal(pack.pack, 'little-prince');
for (const ch of pack.characters) {
  assert.ok(ch.zone?.objects?.length, `${ch.name} needs zone`);
  assert.ok(ch.homeProp || ch.zone.homeProp, `${ch.name} needs homeProp`);
}

const parsed = parseScenario(`${pack.source}\n\nПринц спросил Лиса про приручение. Роза капризничала. Король отдал приказ. Лётчик искал воду. Фонарщик зажигал фонарь.`.repeat(2));
assert.equal(parsed.pack, 'little-prince');
for (const name of ['Принц', 'Лис', 'Роза']) {
  const row = parsed.characters.find((item) => item.name === name);
  assert.ok(row?.zone?.title, `${name} keeps zone after parse`);
}

console.log('actor-stage beats smoke: ok', ordered.map((item) => item.name).join(' › '));
