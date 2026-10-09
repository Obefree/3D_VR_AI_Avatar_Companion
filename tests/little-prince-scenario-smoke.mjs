import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseScenario } from '../scenario/parse.mjs';
import {
  LITTLE_PRINCE_CARDS,
  LITTLE_PRINCE_ZONES,
  isLittlePrinceText,
  littlePrinceDefaultPack,
} from '../scenario/packs/little-prince.mjs';

const DESKTOP = path.join(process.env.USERPROFILE || '', 'Desktop', 'Маленький принц.txt');

/** Short original scene — same roles, not book text. Used when Desktop file is absent. */
const SYNTH = `
Сцена Nova: Маленький принц. Принц смотрит на Розу и спрашивает: «Что значит приручить?»
Лис сидит у пшеницы и отвечает: «Приручи меня». Роза на планете принца капризничает.
Король на своей крошечной планете говорит: «Подойди». Лётчик встречается у колодца в пустыне.
Фонарщик зажигает свой фонарь. Так живут эти роли. Это сценарий примера.
`.repeat(3);

function loadSource() {
  if (fs.existsSync(DESKTOP)) {
    const text = fs.readFileSync(DESKTOP, 'utf8');
    assert.ok(isLittlePrinceText(text), 'desktop file should match little-prince pack');
    return { text: text.slice(0, 20000), from: 'desktop' };
  }
  return { text: SYNTH, from: 'synth' };
}

const builtin = littlePrinceDefaultPack();
assert.equal(builtin.pack, 'little-prince');
assert.equal(builtin.world.mood, 'planets');
assert.ok(builtin.characters.length >= 6, 'default pack needs core roles');
for (const name of Object.keys(LITTLE_PRINCE_CARDS)) {
  const row = builtin.characters.find((item) => item.name === name);
  assert.ok(row, `default missing ${name}`);
  assert.ok(row.zone?.objects?.length, `${name} needs personal zone`);
  assert.equal(row.zone.title, LITTLE_PRINCE_ZONES[name].title);
  assert.ok(row.openingSeed, `${name} needs openingSeed`);
  assert.ok(row.memory, `${name} needs memory`);
}

const { text, from } = loadSource();
const parsed = parseScenario(text);

assert.equal(parsed.pack, 'little-prince');
assert.equal(parsed.world.mood, 'planets');
assert.ok(parsed.world.objects.some((item) => item.shape === 'planet'), 'need walkable planet spheres');
assert.ok(parsed.world.objects.filter((item) => item.shape === 'planet').length >= 3, 'need several planets');

for (const name of ['Принц', 'Лис', 'Роза', 'Лётчик', 'Король', 'Фонарщик']) {
  const row = parsed.characters.find((item) => item.name === name);
  assert.ok(row, `missing ${name} in ${parsed.characters.map((c) => c.name).join(', ')}`);
  assert.ok(row.want, `${name} missing want`);
  assert.ok((row.relations || []).length, `${name} missing relations`);
  assert.ok((row.talkThemes || []).length, `${name} missing talkThemes`);
  assert.equal(row.want, LITTLE_PRINCE_CARDS[name].want);
  assert.ok(row.zone?.title, `${name} should keep zone after parse`);
}

console.log(`little-prince scenario smoke: ok (${from}) roles=${parsed.characters.map((c) => c.name).join(', ')} planets=${parsed.world.objects.filter((o) => o.shape === 'planet').length} defaultZones=${builtin.characters.length}`);
