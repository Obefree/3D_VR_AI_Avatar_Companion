import assert from 'node:assert/strict';
import { guessCharactersFromText, parseScenario } from '../scenario/parse.mjs';

const excerpt = `
Жили-были король и королева. Король сказал принцу: «Иди в лес и найди камень».
Принц пошёл в чащу. Ведьма жила в избушке. Она сказала: «Останься, я добрая».
Итак, принц остался. Все боялись ведьму. Ведь лес был тёмен. Для путника это испытание.
Мне бы такое не снилось. Земле он поклонился и пошёл дальше.
`.repeat(2);

const roster = guessCharactersFromText(excerpt);
const names = roster.map((item) => item.name);
const junk = names.filter((name) => ['Ведь', 'Все', 'Итак', 'Для', 'Мне', 'Земле', 'Земля', 'Маленький', 'Нарисуй', 'Приручи'].includes(name));
assert.deepEqual(junk, [], `junk names leaked: ${junk.join(', ')}`);
assert.ok(names.includes('Король'), `missing Король in ${names.join(', ')}`);
assert.ok(names.includes('Принц'), `missing Принц in ${names.join(', ')}`);
assert.ok(names.includes('Ведьма'), `missing Ведьма in ${names.join(', ')}`);
const king = roster.find((item) => item.name === 'Король');
const prince = roster.find((item) => item.name === 'Принц');
const witch = roster.find((item) => item.name === 'Ведьма');
assert.equal(king.role, 'Король');
assert.equal(prince.role, 'Принц');
assert.equal(witch.role, 'Ведьма');
assert.equal(witch.pronoun, 'она');
assert.ok(king.meaning || king.speechManner, 'king has no traits from text');
assert.ok(prince.movement || prince.meaning, 'prince has no traits from text');

const little = guessCharactersFromText(`
Маленький принц сказал: «Нарисуй мне барашка». Лётчик нарисовал.
Лис подошёл и сказал: «Приручи меня». Роза качала головой на своей планете.
`.repeat(3));
const littleNames = little.map((item) => item.name);
assert.ok(littleNames.includes('Принц'), `missing Принц in ${littleNames.join(', ')}`);
assert.ok(littleNames.includes('Лис'), `missing Лис in ${littleNames.join(', ')}`);
assert.ok(littleNames.includes('Роза'), `missing Роза in ${littleNames.join(', ')}`);
assert.ok(littleNames.includes('Лётчик'), `missing Лётчик in ${littleNames.join(', ')}`);

const parsed = parseScenario(excerpt);
assert.equal(parsed.world.mood, 'forest');
assert.ok((parsed.world.objects || []).length >= 3, 'forest has props');
const kingCard = parsed.characters.find((item) => item.name === 'Король');
assert.ok(kingCard?.homeProp, 'king has a home landmark');
assert.ok(
  parsed.world.objects.some((item) => item.id === kingCard.homeProp || /трон/i.test(item.label)),
  'king landmark lives in the room',
);

const spokenLc = guessCharactersFromText(`
и тогда маша сказала: «Пойдём». иван спросил: «Куда?». маша ответила: «В лес, там тише».
`.repeat(2));
const spokenLcNames = spokenLc.map((item) => item.name);
assert.ok(spokenLcNames.includes('Маша'), `missing Маша in ${spokenLcNames.join(', ')}`);
assert.ok(spokenLcNames.includes('Иван'), `missing Иван in ${spokenLcNames.join(', ')}`);

const diary = parseScenario(`
Я пошёл в лес и увидел дом у реки. Я сказал себе: держись. Мне казалось, что кто-то следит из чащи. Я решил войти и проверить, что внутри комнаты у окна.
`);
assert.ok(diary.characters.some((item) => item.name === 'Рассказчик'), `missing narrator in ${diary.characters.map((item) => item.name).join(', ')}`);

console.log('parse roles smoke: ok', names.join(', '), '|', littleNames.join(', '));

