/** Scenario cards from text. No Three.js, no Ollama. Works in the browser workbench and on the Nova server. */

import {
  isLittlePrinceText,
  littlePrinceWorld,
  overlayLittlePrinceCards,
  littlePrinceDefaultPack,
  LITTLE_PRINCE_CARDS,
} from './packs/little-prince.mjs';

const FORBIDDEN_TARGETS = new Set(['device', 'red_button', 'filter']);

function normalizePersonName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim();
}

function asStringList(value, max = 8) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, max);
}

function normalizeAppearance(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const notes = raw.trim().slice(0, 240);
    return notes ? { notes } : null;
  }
  if (typeof raw !== 'object') return null;
  const notes = String(raw.notes || raw.description || '').trim().slice(0, 240);
  const hair = String(raw.hair || '').trim().slice(0, 16);
  const skin = String(raw.skin || '').trim().slice(0, 16);
  const clothes = String(raw.clothes || '').trim().slice(0, 16);
  if (!notes && !hair && !skin && !clothes) return null;
  return { notes, hair, skin, clothes };
}

function normalizeCharacter(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 80);
  if (!name) return null;
  return {
    name,
    aliases: asStringList(raw.aliases, 8),
    temperament: String(raw.temperament || '').trim().slice(0, 500),
    habits: asStringList(raw.habits, 8),
    speechManner: String(raw.speechManner || '').trim().slice(0, 500),
    relations: asStringList((raw.relations || []).map((item) => (
      typeof item === 'string' ? item : `${item?.name || ''}: ${item?.bond || item?.want || item?.note || ''}`.replace(/^:\s*/, '')
    )), 8),
    knowledge: asStringList(raw.knowledge, 10),
    goals: asStringList(raw.goals, 6),
    meaning: String(raw.meaning || '').trim().slice(0, 400),
    want: String(raw.want || '').trim().slice(0, 180),
    forbidden: String(raw.forbidden || '').trim().slice(0, 180),
    role: String(raw.role || '').trim().slice(0, 80),
    pronoun: String(raw.pronoun || '').trim().toLowerCase().slice(0, 8),
    movement: String(raw.movement || '').trim().slice(0, 300),
    talkThemes: asStringList(raw.talkThemes, 8),
    memory: String(raw.memory || '').trim().slice(0, 900),
    appearance: normalizeAppearance(raw.appearance),
  };
}

function mergeCharacters(rows) {
  const map = new Map();
  const remember = (key, character) => {
    if (!key) return;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...character, aliases: [...character.aliases] });
      return;
    }
    prev.aliases = asStringList([...prev.aliases, ...character.aliases, character.name, prev.name], 10);
    if ((character.temperament || '').length > (prev.temperament || '').length) prev.temperament = character.temperament;
    if ((character.speechManner || '').length > (prev.speechManner || '').length) prev.speechManner = character.speechManner;
    prev.habits = asStringList([...prev.habits, ...character.habits], 8);
    prev.relations = asStringList([...prev.relations, ...character.relations], 8);
    prev.knowledge = asStringList([...(prev.knowledge || []), ...(character.knowledge || [])], 10);
    prev.goals = asStringList([...(prev.goals || []), ...(character.goals || [])], 6);
    if ((character.meaning || '').length > (prev.meaning || '').length) prev.meaning = character.meaning;
    if ((character.want || '').length > (prev.want || '').length) prev.want = character.want;
    if ((character.forbidden || '').length > (prev.forbidden || '').length) prev.forbidden = character.forbidden;
    if (!prev.role && character.role) prev.role = character.role;
    if (!prev.pronoun && character.pronoun) prev.pronoun = character.pronoun;
    if ((character.movement || '').length > (prev.movement || '').length) prev.movement = character.movement;
    prev.talkThemes = asStringList([...(prev.talkThemes || []), ...(character.talkThemes || [])], 8);
    if (!prev.appearance && character.appearance) prev.appearance = character.appearance;
  };
  for (const character of rows) {
    const key = normalizePersonName(character.name);
    remember(key, character);
    for (const alias of character.aliases) remember(normalizePersonName(alias), map.get(key) || character);
  }
  const seen = new Set();
  const unique = [];
  for (const character of map.values()) {
    const key = normalizePersonName(character.name);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(character);
  }
  return unique.slice(0, 12);
}

function chunkText(text, size = 2200) {
  return [String(text || '').slice(0, size)].filter(Boolean);
}

const NAME_STOP = new Set(`
он она они оно мы вы я ты это его ее её их себя сам сама
мне меня мной нам нас нами вам вас вами тебе тебя тобой
себе собой ему ей им ими ней нем нём них
ведь все всего всех вся всю всей всем всеми
итак значит например впрочем кстати просто даже именно
для земле земли землю землей землёй земля
день дня днём раз раза дело дела время жизни жизнь мир света свет
год года годы там тут сюда туда отсюда потому поэтому затем далее
тем не ни ли же бы ка ну ох ах ой увы хотя хоть либо или но а и
да нет вот вон так этак пускай пусть словно будто точно якобы
типа вообще совсем очень слишком чуть едва вдруг опять снова уже ещё еще
пока как что чем кем кому кого чего чему чей чья чьё чьи
каждый каждая каждое каждые другой другая другое другие
весь никто ничто некто нечто некий некая
сейчас теперь тогда завтра вчера сегодня утром вечером ночью
куда где зачем почему какой какая которое который которая
если когда чтобы дабы ибо мол дескать стало быть может нужно надо можно нельзя
есть нет был была буду будет стали стала стал
the and but you she he his her him they them that this when then
chapter глава том книга часть пролог эпилог автор примечание
после перед если когда пока хотя чтобы потому только уже еще ещё
был была были будет сказал сказала говорит думает видит стоит
потом тогда здесь теперь однако вдруг значит поэтому сегодня завтра
однажды наконец сначала снова опять почти сразу между среди против
кроме вместо вокруг около нет да вот так как что кто где куда
откуда почему зачем какой какая какое какие этот эта эти тот та то те
мой моя мое моё наш наша ваша ваш человек люди мужчина женщина
мальчик девочка друг враг
дверь дом стол окно комната школа улица ночь утро вечер день
door house table window room school street night morning evening
there from with have were their what will would could should about
which while after before once until since although because however
suddenly meanwhile finally therefore somebody anyone everyone nobody
слушай смотри знаешь понимаешь кажется конечно ладно хорошо прости извини давай
разве неужели правда жил жили было будто
маленький большой старый новый добрый злой бедный богатый первый второй третий
молодой молодая родной милый хороший плохой странный странная
нарисуй приручи посмотри послушай подожди скажи дай возьми иди пойди расскажи покажи
`.trim().split(/\s+/));

const ROLE_ENTRIES = [
  ['Принц', 'принц принца принцу принцем принце принцы принцев принцам'],
  ['Принцесса', 'принцесса принцессы принцессе принцессу принцессой принцесс'],
  ['Король', 'король короля королю королём королем короле короли королей королям'],
  ['Королева', 'королева королевы королеве королеву королевой королев'],
  ['Царь', 'царь царя царю царём царем царе цари царей'],
  ['Царица', 'царица царицы царице царицу царицей цариц'],
  ['Царевна', 'царевна царевны царевне царевну царевной царевен'],
  ['Ведьма', 'ведьма ведьмы ведьме ведьму ведьмой ведьм ведьмою'],
  ['Ведьмак', 'ведьмак ведьмака ведьмаку ведьмаком ведьмаке'],
  ['Охотник', 'охотник охотника охотнику охотником охотнике охотники охотников'],
  ['Капитан', 'капитан капитана капитану капитаном капитане капитаны'],
  ['Доктор', 'доктор доктора доктору доктором докторе'],
  ['Рыцарь', 'рыцарь рыцаря рыцарю рыцарем рыцаре рыцари рыцарей'],
  ['Маг', 'маг мага магу магом маге маги магов'],
  ['Волшебник', 'волшебник волшебника волшебнику волшебником волшебнике волшебники'],
  ['Волшебница', 'волшебница волшебницы волшебнице волшебницу волшебницей'],
  ['Барон', 'барон барона барону бароном бароне'],
  ['Стражник', 'стражник стражника стражнику стражником стражнике стражники'],
  ['Слуга', 'слуга слуги слуге слугу слугой слуг'],
  ['Служанка', 'служанка служанки служанке служанку служанкой'],
  ['Хозяин', 'хозяин хозяина хозяину хозяином хозяине'],
  ['Хозяйка', 'хозяйка хозяйки хозяйке хозяйку хозяйкой'],
  ['Путник', 'путник путника путнику путником путнике путники'],
  ['Гость', 'гость гостя гостю гостем госте гости гостей'],
  ['Гостья', 'гостья гостьи гостье гостью гостьей'],
  ['Солдат', 'солдат солдата солдату солдатом солдате солдаты'],
  ['Купец', 'купец купца купцу купцом купце купцы купцов'],
  ['Мачеха', 'мачеха мачехи мачехе мачеху мачехой'],
  ['Демон', 'демон демона демону демоном демоне'],
  ['Дракон', 'дракон дракона дракону драконом драконе'],
  ['Ангел', 'ангел ангела ангелу ангелом ангеле'],
  ['Лис', 'лис лиса лису лисом лисе лисы fox'],
  ['Роза', 'роза розы розе розу розой rose'],
  ['Лётчик', 'летчик лётчик летчика лётчика летчику лётчику pilot aviator'],
  ['Змея', 'змея змеи змею змеей snake'],
  ['Prince', 'prince princes'],
  ['Princess', 'princess'],
  ['King', 'king kings'],
  ['Queen', 'queen queens'],
  ['Witch', 'witch witches'],
  ['Captain', 'captain'],
  ['Doctor', 'doctor'],
  ['Knight', 'knight knights'],
  ['Wizard', 'wizard wizards'],
  ['Baron', 'baron'],
  ['Мама', 'мама мамы маме маму мамой мамою'],
  ['Папа', 'папа папы папе папу папой папою'],
  ['Бабушка', 'бабушка бабушки бабушке бабушку бабушкой'],
  ['Дедушка', 'дедушка дедушки дедушке дедушку дедушкой'],
  ['Учитель', 'учитель учителя учителю учителем учителе'],
  ['Учительница', 'учительница учительницы учительнице учительницу учительницей'],
];

const ROLE_FORM_TO_CANON = new Map();
for (const [name, forms] of ROLE_ENTRIES) {
  ROLE_FORM_TO_CANON.set(normalizePersonName(name), name);
  for (const form of String(forms).split(/\s+/).filter(Boolean)) {
    ROLE_FORM_TO_CANON.set(normalizePersonName(form), name);
  }
}

const PRONOUN_SLOTS = new Set(['он', 'она', 'he', 'she']);
const FEMALE_ROLE = /принцесса|королева|ведьма|царица|царевна|волшебница|хозяйка|мачеха|гостья|служанка|роза|змея|мама|бабушка|учительница|princess|queen|witch|rose/;

const SAID_WORD = 'said|asked|replied|whispered|cried|muttered|shouted|told|answered|called|yelled|added|continued|interrupted|Said|Asked|Replied|сказал[аои]?|спросил[аои]?|ответил[аои]?|крикнул[аои]?|прошептал[аои]?|молвил[аои]?|произнес[ла]?|произнёс|проговорил[а]?|отозвался|отозвалась|перебил[а]?|пробормотал[а]?|заметил[а]?|продолжил[а]?|подумал[а]?|воскликнул[а]?|возразил[а]?|объявил[а]?|шепнул[а]?|закричал[а]?|пояснил[а]?|Сказал[аои]?|Спросил[аои]?|Ответил[аои]?|Крикнул[аои]?';
const SAID_WORD_LC = 'сказал[аои]?|спросил[аои]?|ответил[аои]?|крикнул[аои]?|прошептал[аои]?|молвил[аои]?|произнес[ла]?|произнёс|проговорил[а]?|отозвался|отозвалась|подумал[а]?|воскликнул[а]?|возразил[а]?|объявил[а]?|шепнул[а]?|закричал[а]?|пояснил[а]?';
const NAME_TOKEN = "([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\\-]{1,24}(?:\\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\\-]{1,24}){0,2})";
const NAME_TOKEN_LC = "([a-zа-яё][a-zа-яё'’\\-]{2,24})";

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tidyPersonName(raw) {
  let name = String(raw || '')
    .replace(/^["«“'`]+|["»”'`.,:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return '';
  const letters = name.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) {
    name = name.toLowerCase().replace(/(^|[\s'-])([a-zа-яё])/g, (_, a, b) => a + b.toUpperCase());
  }
  return name.slice(0, 40);
}

function roleCanon(raw) {
  return ROLE_FORM_TO_CANON.get(normalizePersonName(raw)) || '';
}

function isRoleName(raw) {
  return Boolean(roleCanon(raw));
}

function isPronounSlot(raw) {
  return PRONOUN_SLOTS.has(normalizePersonName(raw));
}

function isFemaleCard(character) {
  const blob = `${character?.name || ''} ${character?.role || ''} ${character?.pronoun || ''}`.toLowerCase();
  return /она|she/.test(blob) || FEMALE_ROLE.test(blob);
}

function isCharacterLabel(raw) {
  const name = tidyPersonName(raw);
  if (isPronounSlot(name) || isRoleName(name)) return Boolean(name);
  return isPersonName(name);
}

function titleCasePerson(raw) {
  return String(raw || '').toLowerCase().replace(/(^|[\s'-])([a-zа-яё])/g, (_, a, b) => a + b.toUpperCase());
}

function isPersonName(raw) {
  const name = tidyPersonName(raw);
  if (!name || name.length < 2 || name.length > 40) return false;
  if (/\d/.test(name)) return false;
  if (!/^[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’-]{1,24}(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’-]{1,24}){0,2}$/.test(name)) return false;
  const key = normalizePersonName(name);
  if (!key || NAME_STOP.has(key)) return false;
  const parts = name.split(' ');
  if (parts.some((part) => NAME_STOP.has(part.toLowerCase().replace(/ё/g, 'е')))) return false;
  return true;
}

function countFormHits(text, form) {
  const re = new RegExp(`(?:^|[^A-Za-zА-Яа-яЁё])${escapeRegExp(form)}(?=[^A-Za-zА-Яа-яЁё]|$)`, 'gi');
  return (String(text || '').match(re) || []).length;
}

function guessRolesFromText(text) {
  const slice = String(text || '').slice(0, 80000);
  const rows = [];
  const seen = new Set();
  for (const [name, forms] of ROLE_ENTRIES) {
    let hits = 0;
    for (const form of `${normalizePersonName(name)} ${forms}`.split(/\s+/).filter(Boolean)) {
      hits += countFormHits(slice, form);
    }
    if (hits < 1 || seen.has(name)) continue;
    seen.add(name);
    const female = FEMALE_ROLE.test(name.toLowerCase());
    rows.push(normalizeCharacter({
      name,
      role: name,
      pronoun: female ? 'она' : 'он',
    }));
  }
  return rows;
}

function sentencesAbout(text, needles) {
  const parts = String(text || '').split(/(?<=[.!?…])\s+/);
  const checks = needles.map((item) => String(item || '').trim()).filter((item) => item.length >= 2);
  return parts.filter((sentence) => checks.some((item) => {
    const re = new RegExp(`(?:^|[^A-Za-zА-Яа-яЁё])${escapeRegExp(item)}(?=[^A-Za-zА-Яа-яЁё]|$)`, 'i');
    return re.test(sentence);
  }));
}

function enrichCharacterFromText(character, text) {
  if (!character?.name) return character;
  const forms = [...ROLE_FORM_TO_CANON.entries()]
    .filter(([, canon]) => canon === character.name || canon === character.role)
    .map(([form]) => form);
  const needles = [character.name, character.role, ...(character.aliases || []), ...forms]
    .filter(Boolean);
  const about = sentencesAbout(text, needles).slice(0, 8);
  const blob = about.join(' ');
  if (!character.meaning && about[0]) character.meaning = about[0].replace(/\s+/g, ' ').trim().slice(0, 220);
  if (!character.movement) {
    const move = blob.match(/\b(?:пош[её]л[аи]?|бежал[аи]?|встал[аи]?|сел[аи]?|обернул(?:ся|ась)|подош[её]л[а]?|шёл|шла|шел)\b/i);
    if (move) character.movement = move[0];
  }
  if (!character.appearance) {
    const look = blob.match(/\b(?:волос[аыу].{0,24}|глаз[а].{0,20}|в\s+(?:красном|белом|чёрном|черном|платье|плаще|короне).{0,16})\b/i);
    if (look) character.appearance = { notes: look[0].slice(0, 120) };
  }
  if (!(character.goals || []).length) {
    const goal = blob.match(/\b(?:хотел[аои]?|должен|должна|искал[а]?|решил[а]?)\s+[^.!?]{3,70}/i);
    if (goal) character.goals = [goal[0].trim().slice(0, 140)];
  }
  if (!character.temperament) {
    const temper = blob.match(/\b(?:зл(?:ой|ая)|добр(?:ый|ая)|гневн(?:ый|ая)|тих(?:ий|ая)|смел(?:ый|ая)|хитр(?:ый|ая)|жестокий|жестокая)\b/i);
    if (temper) character.temperament = temper[0];
  }
  if (!character.role && roleCanon(character.name)) character.role = roleCanon(character.name);
  if (!character.pronoun) character.pronoun = isFemaleCard(character) ? 'она' : 'он';
  if (!character.want) character.want = (character.goals || [])[0] || '';
  return character;
}

function guessPronounSlots(text) {
  const slice = String(text || '').slice(0, 80000);
  const she = (slice.match(/\bона\s+(?:сказал|спросил|ответил|крикнул|прошептал|молвил|подумал|воскликнул|шла|была|сделал)|she said|said she/gi) || []).length;
  const he = (slice.match(/\bон\s+(?:сказал|спросил|ответил|крикнул|прошептал|молвил|подумал|воскликнул|шел|шёл|был|сделал)|he said|said he/gi) || []).length;
  const rows = [];
  if (she >= 1) rows.push(normalizeCharacter({ name: 'Она', role: 'героиня по местоимению', pronoun: 'она' }));
  if (he >= 1) rows.push(normalizeCharacter({ name: 'Он', role: 'герой по местоимению', pronoun: 'он' }));
  return rows.filter(Boolean);
}

function guessNarrator(text) {
  const slice = String(text || '').slice(0, 80000);
  const cues = (slice.match(/(?:^|[.!?…\n]\s*)Я\s+[а-яёa-z]|(?:^|[.!?…\n]\s*)я\s+(?:сказал|спросил|подумал|увидел|понял|решил|пош[её]л|шел|шёл|шла)|меня\s+зовут|мне\s+(?:сказали|казалось|было)/gi) || []).length;
  if (cues < 2) return [];
  return [normalizeCharacter({
    name: 'Рассказчик',
    role: 'рассказчик',
    pronoun: 'я',
    meaning: 'ведёт текст от первого лица',
  })];
}

function attachPronouns(characters) {
  const named = characters.filter((item) => !isPronounSlot(item.name));
  const slots = characters.filter((item) => isPronounSlot(item.name));
  if (!slots.length) return characters;
  if (named.length === 1) {
    const only = named[0];
    only.aliases = asStringList([...only.aliases, ...slots.map((item) => item.name)], 10);
    if (!only.pronoun) only.pronoun = slots[0].pronoun || normalizePersonName(slots[0].name);
    return named;
  }
  const leftover = [];
  for (const slot of slots) {
    const she = /она|she/.test(normalizePersonName(slot.name));
    const pool = named.filter((item) => (she ? isFemaleCard(item) : !isFemaleCard(item)));
    if (pool.length === 1) {
      pool[0].aliases = asStringList([...pool[0].aliases, slot.name], 10);
      if (!pool[0].pronoun) pool[0].pronoun = slot.pronoun || normalizePersonName(slot.name);
    } else leftover.push(slot);
  }
  return [...named, ...leftover];
}

function guessCharactersFromText(text) {
  const slice = String(text || '').slice(0, 80000);
  const spoken = new Map();
  const bump = (raw, by = 1) => {
    const name = tidyPersonName(raw);
    const role = roleCanon(name);
    if (role) {
      spoken.set(role, (spoken.get(role) || 0) + by);
      return;
    }
    if (!isPersonName(name) || isPronounSlot(name)) return;
    spoken.set(name, (spoken.get(name) || 0) + by);
  };
  const saidBefore = new RegExp(`${NAME_TOKEN}\\s+(?:${SAID_WORD})`, 'g');
  const saidAfter = new RegExp(`(?:${SAID_WORD})\\s+${NAME_TOKEN}`, 'g');
  const saidLcBefore = new RegExp(`(?:^|[^A-Za-zА-Яа-яЁё])${NAME_TOKEN_LC}\\s+(?:${SAID_WORD_LC})`, 'gi');
  const saidLcAfter = new RegExp(`(?:${SAID_WORD_LC})\\s+${NAME_TOKEN_LC}(?=[^A-Za-zА-Яа-яЁё]|$)`, 'gi');
  const namedAs = new RegExp(`(?:зовут|имя)\\s+${NAME_TOKEN}`, 'gi');
  let match;
  while ((match = saidBefore.exec(slice))) bump(match[1], 3);
  while ((match = saidAfter.exec(slice))) bump(match[1], 3);
  while ((match = saidLcBefore.exec(slice))) bump(titleCasePerson(match[1]), 3);
  while ((match = saidLcAfter.exec(slice))) bump(titleCasePerson(match[1]), 3);
  while ((match = namedAs.exec(slice))) bump(match[1], 3);
  const scriptName = new RegExp(`^[ \\t]*${NAME_TOKEN}\\s*:`, 'gm');
  while ((match = scriptName.exec(slice))) bump(match[1], 2);
  const scriptNameLc = new RegExp(`^[ \\t]*${NAME_TOKEN_LC}\\s*:`, 'gm');
  while ((match = scriptNameLc.exec(slice))) bump(titleCasePerson(match[1]), 2);
  const speakers = [...spoken.entries()]
    .filter(([name, score]) => roleCanon(name) || score >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name]) => normalizeCharacter({
      name,
      role: roleCanon(name) || '',
      pronoun: FEMALE_ROLE.test(String(name).toLowerCase()) ? 'она' : '',
    }))
    .filter(Boolean);
  const merged = mergeCharacters([
    ...guessRolesFromText(text),
    ...speakers,
    ...guessNamedPeople(text),
    ...guessPronounSlots(text),
    ...guessNarrator(text),
  ]);
  return merged.map((row) => enrichCharacterFromText(row, text));
}

function guessNamedPeople(text) {
  const slice = String(text || '').slice(0, 80000);
  const counts = new Map();
  const re = new RegExp(NAME_TOKEN, 'g');
  let match;
  while ((match = re.exec(slice))) {
    const name = tidyPersonName(match[1]);
    if (!isPersonName(name) || isPronounSlot(name) || roleCanon(name)) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([name, n]) => (name.includes(' ') ? n >= 2 : n >= 3))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name]) => normalizeCharacter({ name }))
    .filter(Boolean);
}

function rowsFromParse(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed.characters)) return parsed.characters;
  if (Array.isArray(parsed.people)) return parsed.people;
  if (Array.isArray(parsed.names)) return parsed.names.map((name) => ({ name }));
  if (Array.isArray(parsed)) return parsed;
  return [];
}

const MOOD_PALETTES = {
  temple: { wall: '#3a2e24', floor: '#1c1612', light: '#e8b060' },
  castle: { wall: '#2a2430', floor: '#161418', light: '#e0c090' },
  street: { wall: '#2a3038', floor: '#1a1e22', light: '#c8d0d8' },
  forest: { wall: '#1a2818', floor: '#24301c', light: '#d4e0a8' },
  ship: { wall: '#1a2838', floor: '#121820', light: '#80c8ff' },
  lab: { wall: '#243038', floor: '#151c22', light: '#c0e8ff' },
  apartment: { wall: '#2a3038', floor: '#1a1e24', light: '#c8d8e8' },
  other: { wall: '#2a3038', floor: '#1a1e24', light: '#c8d8e8' },
  planets: { wall: '#070b18', floor: '#0a0e1a', light: '#ffe6a8' },
};

function worldFromMood(mood, text) {
  if (mood === 'planets' || isLittlePrinceText(text)) {
    return littlePrinceWorld();
  }
  const title = ({
    temple: 'Храм', castle: 'Замок', street: 'Улица', forest: 'Лес',
    ship: 'Корабль', lab: 'Лаборатория', apartment: 'Квартира', other: 'Комната',
  })[mood] || 'Комната';
  const palettes = MOOD_PALETTES;
  const objects = {
    temple: [
      { id: 'actor_table', label: 'Алтарь', shape: 'cylinder', color: '#5b4434', x: 1.2, z: -1.1 },
      { id: 'element_fire', label: 'Огонь', shape: 'crystal', color: '#e45c28', x: 1.5, z: -0.9 },
      { id: 'element_water', label: 'Вода', shape: 'crystal', color: '#3aa0e8', x: 0.9, z: -0.9 },
    ],
    castle: [
      { id: 'castle_throne', label: 'Трон', shape: 'box', color: '#6b4a28', x: 0, z: -3.2 },
      { id: 'castle_torch', label: 'Факел', shape: 'cone', color: '#e08a32', x: -2.4, z: -1.2 },
      { id: 'castle_cup', label: 'Кубок', shape: 'cylinder', color: '#c9a227', x: 1.1, z: -0.6 },
    ],
    street: [
      { id: 'street_lamp', label: 'Фонарь', shape: 'cone', color: '#d8c4a0', x: -2.2, z: 1.4 },
      { id: 'street_crate', label: 'Ящик', shape: 'box', color: '#6a4a32', x: 1.6, z: -0.8 },
      { id: 'street_sign', label: 'Вывеска', shape: 'box', color: '#3a5070', x: -1.4, z: -4.2 },
    ],
    forest: [
      { id: 'forest_stump', label: 'Пень', shape: 'cylinder', color: '#5a3a22', x: 1.1, z: -0.7 },
      { id: 'forest_stone', label: 'Камень', shape: 'sphere', color: '#6a6a62', x: -1.2, z: 0.8 },
      { id: 'forest_lantern', label: 'Фонарь', shape: 'cone', color: '#d4b56a', x: 0.4, z: 1.6 },
    ],
    ship: [
      { id: 'ship_console', label: 'Пульт', shape: 'box', color: '#2a4a68', x: 0.2, z: -2.4 },
      { id: 'ship_port', label: 'Иллюминатор', shape: 'window', color: '#80c8ff', x: -1.9, z: -10.4, y: 2.1 },
      { id: 'ship_crate', label: 'Контейнер', shape: 'box', color: '#3a3a44', x: 2.1, z: 0.8 },
    ],
    lab: [
      { id: 'lab_bench', label: 'Стол', shape: 'box', color: '#4a5860', x: 1.4, z: -1.0 },
      { id: 'lab_tank', label: 'Колба', shape: 'cylinder', color: '#7ad0d8', x: -1.1, z: -0.4 },
      { id: 'lab_lamp', label: 'Лампа', shape: 'cone', color: '#c0e8ff', x: 2.0, z: 0.6 },
    ],
    apartment: [
      { id: 'apt_table', label: 'Стол', shape: 'cylinder', color: '#5b4434', x: 1.2, z: -0.9 },
      { id: 'apt_chair', label: 'Стул', shape: 'box', color: '#27384a', x: -0.5, z: 0.7 },
      { id: 'apt_lamp', label: 'Лампа', shape: 'cone', color: '#d8c4a0', x: 2.1, z: 0.4 },
      { id: 'apt_window', label: 'Окно', shape: 'window', color: '#668eb4', x: -1.9, z: -10.9, y: 2.05 },
    ],
  };
  return {
    title,
    mood,
    notes: `${title} из текста. Ходи, смотри, говори.`,
    palette: palettes[mood] || palettes.apartment,
    objects: objects[mood] || objects.apartment,
    sourceHint: String(text || '').slice(0, 180),
  };
}

function characterBlob(character) {
  const look = character?.appearance;
  const notes = typeof look === 'string' ? look : (look?.notes || '');
  return [
    character?.name, character?.role, character?.want, character?.meaning,
    character?.movement, character?.memory, notes,
    ...(character?.knowledge || []),
    ...(character?.goals || []),
  ].join(' ').toLowerCase();
}

function landmarkForCharacter(character, index) {
  const blob = characterBlob(character);
  const slug = String(character?.name || `actor_${index}`)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || `actor_${index}`;
  const id = `home_${slug}`;
  let spec = { id, label: character?.name || 'Якорь', shape: 'box', color: '#6688aa' };
  if (/роз|цвет|шип/.test(blob)) spec = { id, label: 'Роза', shape: 'cone', color: '#e04560' };
  else if (/трон|корол/.test(blob)) spec = { id, label: 'Трон', shape: 'box', color: '#8a6a28' };
  else if (/фонар/.test(blob)) spec = { id, label: 'Фонарь', shape: 'cone', color: '#ffe6a8' };
  else if (/окн|стекл|дожд/.test(blob)) spec = { id, label: 'Окно', shape: 'window', color: '#668eb4', y: 2.05, x: -1.9, z: -10.9 };
  else if (/лис|пшен|поле/.test(blob)) spec = { id, label: 'Пшеница', shape: 'cone', color: '#d4b56a' };
  else if (/колод|пустын|лётчик|самолёт|пилот/.test(blob)) spec = { id, label: 'Колодец', shape: 'cylinder', color: '#5a6570' };
  else if (/стакан|кадр/.test(blob)) spec = { id, label: 'Стакан', shape: 'cylinder', color: '#b9dcf1' };
  else if (/стол/.test(blob)) spec = { id, label: 'Стол', shape: 'cylinder', color: '#5b4434' };
  else if (/камн|лес/.test(blob)) spec = { id, label: 'Камень', shape: 'sphere', color: '#6a6a62' };
  else if (/алтар|храм|огонь/.test(blob)) spec = { id, label: 'Алтарь', shape: 'cylinder', color: '#5b4434' };
  if (spec.x == null) {
    const angle = (index / Math.max(4, index + 3)) * Math.PI * 2;
    spec.x = Number((Math.cos(angle) * 3.2).toFixed(2));
    spec.z = Number((Math.sin(angle) * 3.2 - 0.4).toFixed(2));
  }
  return spec;
}

/** Ensure the room has a landmark per role so the actor has somewhere to live. */
function fitWorldToCharacters(world, characters) {
  const next = {
    ...(world && typeof world === 'object' ? world : {}),
    objects: [...(world?.objects || [])],
    palette: { ...(world?.palette || {}) },
  };
  const pal = MOOD_PALETTES[next.mood] || MOOD_PALETTES.apartment;
  next.palette = {
    wall: next.palette.wall || pal.wall,
    floor: next.palette.floor || pal.floor,
    light: next.palette.light || pal.light,
  };
  for (const character of characters || []) {
    if (character.zone === world) character.zone = next;
  }
  for (const [index, character] of (characters || []).entries()) {
    const distinct = character.zone && character.zone !== next && Array.isArray(character.zone.objects);
    const target = distinct ? character.zone : next;
    if (!Array.isArray(target.objects)) target.objects = [];
    const ids = new Set(target.objects.map((item) => item.id));
    if (character.homeProp && ids.has(character.homeProp)) continue;
    const spec = landmarkForCharacter(character, index);
    const existing = target.objects.find((item) => (
      String(item.label || '').toLowerCase() === String(spec.label || '').toLowerCase()
    ));
    if (existing) {
      character.homeProp = existing.id;
      continue;
    }
    target.objects.push(spec);
    character.homeProp = spec.id;
  }
  return next;
}

function clampNum(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeProp(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || raw.label || `prop_${index}`)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  if (!id || FORBIDDEN_TARGETS.has(id) || id.startsWith('__')) return null;
  const shapeRaw = String(raw.shape || 'box').toLowerCase();
  const shape = ['box', 'sphere', 'cylinder', 'cone', 'crystal', 'window', 'planet'].includes(shapeRaw) ? shapeRaw : 'box';
  const color = String(raw.color || '#6688aa').trim().slice(0, 16);
  const radius = clampNum(raw.radius ?? raw.scale, 0.4, 3.5, shape === 'planet' ? 1.5 : 0);
  let x = clampNum(raw.x, -10, 10, 0);
  let z = clampNum(raw.z, -10, 10, 0);
  if (x === 0 && z === 0 && shape !== 'planet') {
    const angle = (index / 8) * Math.PI * 2;
    x = Number((Math.cos(angle) * 2.6).toFixed(2));
    z = Number((Math.sin(angle) * 2.6 - 0.6).toFixed(2));
  }
  const yDefault = shape === 'planet' ? radius : undefined;
  return {
    id,
    label: String(raw.label || id).trim().slice(0, 80) || id,
    shape,
    color,
    x,
    z,
    radius: shape === 'planet' ? radius : undefined,
    y: raw.y == null ? yDefault : clampNum(raw.y, 0.05, 6, yDefault ?? 0.3),
  };
}

function guessMood(text) {
  const blob = String(text || '').toLowerCase();
  if (isLittlePrinceText(text) || /планет[аыуе]|баобаб|прируч/i.test(blob)) return 'planets';
  if (/leeloo|fifth element|пятый элемент|element_water|stones of/.test(blob)) return 'temple';
  if (/hogwart|wizard|замок|castle|potter|хогварт/.test(blob)) return 'castle';
  if (/forest|лес|woodland|дерев/.test(blob)) return 'forest';
  if (/ship|корабл|spaceport|аэропорт/.test(blob)) return 'ship';
  if (/lab|лаборатор|clinic/.test(blob)) return 'lab';
  if (/street|улиц|city|город/.test(blob)) return 'street';
  return 'apartment';
}

function normalizeWorld(raw, fallbackText = '') {
  const src = raw && typeof raw === 'object' ? raw : {};
  const moodRaw = String(src.mood || guessMood(fallbackText)).toLowerCase();
  const mood = ['temple', 'castle', 'street', 'forest', 'ship', 'lab', 'apartment', 'planets', 'other'].includes(moodRaw)
    ? moodRaw
    : 'apartment';
  const fallbackObjects = mood === 'planets' ? littlePrinceWorld().objects : [];
  const objects = (Array.isArray(src.objects) && src.objects.length ? src.objects : fallbackObjects)
    .map(normalizeProp)
    .filter(Boolean)
    .slice(0, 14);
  const palette = src.palette && typeof src.palette === 'object' ? src.palette : {};
  return {
    title: String(src.title || (mood === 'planets' ? 'Планеты' : 'Scene')).trim().slice(0, 80) || 'Scene',
    mood,
    notes: String(src.notes || '').trim().slice(0, 400),
    palette: {
      wall: String(palette.wall || '').trim().slice(0, 16),
      floor: String(palette.floor || '').trim().slice(0, 16),
      light: String(palette.light || '').trim().slice(0, 16),
    },
    objects,
  };
}

function attachZones(characters, payload, sourceText) {
  const world = normalizeWorld(payload?.world || payload, sourceText);
  const rows = Array.isArray(payload?.zones) ? payload.zones : [];
  const byName = new Map();
  for (const row of rows) {
    const name = normalizePersonName(row?.name);
    if (!name) continue;
    byName.set(name, normalizeWorld({ ...world, ...row, objects: row.objects?.length ? row.objects : world.objects }, sourceText));
  }
  for (const character of characters) {
    // Keep pack-authored personal zones (Little Prince areas); only fill gaps.
    if (character.zone?.objects?.length || character.zone?.title) {
      if (!byName.has(normalizePersonName(character.name))) continue;
    }
    character.zone = byName.get(normalizePersonName(character.name)) || character.zone || world;
  }
  return world;
}

export function parseScenario(rawText) {
  const text = String(rawText || '').replace(/\u0000/g, '').trim();
  if (text.length < 40) throw new Error('Нужен отрывок подлиннее — сцена или глава.');
  const truncated = text.length > 120000;
  const source = truncated ? text.slice(0, 120000) : text;
  let characters = attachPronouns(mergeCharacters(guessCharactersFromText(source)));
  characters = characters.map((row) => enrichCharacterFromText(row, source));
  if (isLittlePrinceText(source)) {
    const need = ['Принц', 'Лис', 'Роза', 'Лётчик', 'Король', 'Фонарщик'];
    const have = new Set(characters.map((item) => item.name));
    for (const name of need) {
      if (!have.has(name)) characters.push(normalizeCharacter({ name, role: name }));
    }
    characters = overlayLittlePrinceCards(mergeCharacters(characters));
    const keep = new Set(Object.keys(LITTLE_PRINCE_CARDS || {}));
    // Prefer pack roles; drop incidental book labels that dilute the roster.
    const filtered = characters.filter((row) => keep.has(row.name) || keep.has(row.role));
    if (filtered.length >= 3) characters = filtered;
  }
  const mood = guessMood(source);
  const worldSeed = mood === 'planets' ? { world: littlePrinceWorld() } : { world: worldFromMood(mood, source) };
  const world = fitWorldToCharacters(attachZones(characters, worldSeed, source), characters);
  return {
    version: 1,
    source,
    characters,
    world,
    truncated,
    charsRead: source.length,
    pack: isLittlePrinceText(source) ? 'little-prince' : '',
  };
}

export {
  guessCharactersFromText,
  enrichCharacterFromText,
  mergeCharacters,
  attachPronouns,
  normalizeCharacter,
  normalizePersonName,
  tidyPersonName,
  roleCanon,
  isCharacterLabel,
  isPronounSlot,
  isRoleName,
  rowsFromParse,
  attachZones,
  fitWorldToCharacters,
  worldFromMood,
  guessMood,
  isLittlePrinceText,
  littlePrinceWorld,
  overlayLittlePrinceCards,
  littlePrinceDefaultPack,
};
