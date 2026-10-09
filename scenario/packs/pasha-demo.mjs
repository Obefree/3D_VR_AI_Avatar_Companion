/** Pasha demo pack — original short scene (not copyrighted).
 * Living room: window, table, chair, glass. No scripted checklist.
 */

export const PASHA_DEMO_WORLD = {
  title: 'Комната у окна',
  mood: 'apartment',
  notes: 'Короткая кинематографичная комната для VR-проверки: окно, стол, стул, стакан. Актриса замечает зрителя и действует в кадре.',
  palette: { wall: '#2a3038', floor: '#1a1e24', light: '#c8d8e8' },
  objects: [
    { id: 'actor_window', label: 'Окно', shape: 'window', color: '#668eb4', x: -1.9, z: -10.9, y: 2.05 },
    { id: 'actor_table', label: 'Стол', shape: 'cylinder', color: '#5b4434', x: 1.45, z: -0.95, y: 0.76 },
    { id: 'actor_chair', label: 'Стул', shape: 'box', color: '#27384a', x: -0.2, z: 0.72, y: 0.58 },
    { id: 'actor_glass', label: 'Стакан', shape: 'cylinder', color: '#b9dcf1', x: 1.25, z: -0.94, y: 0.91 },
  ],
};

export const PASHA_DEMO_CHARACTER = {
  name: 'Mara Vale',
  aliases: ['Mara', 'Мара'],
  role: 'Actress',
  pronoun: 'она',
  temperament: 'Сдержанная, точная. Сначала смотрит, потом двигается, потом говорит.',
  want: 'Быть увиденной зрителем в кадре и завершить короткий физический жест со стаканом.',
  forbidden: 'не ассистент; не читать ТЗ; не говорить «Готово»',
  goals: [
    'Заметить человека у окна.',
    'Подойти и коротко поздороваться.',
    'Указать на стакан, взять его, сесть, снова посмотреть на зрителя.',
  ],
  relations: ['человек в VR — зритель в комнате, не рассказчик'],
  talkThemes: ['свет в окне', 'стакан на столе', 'присутствие зрителя'],
  speechManner: 'Короткие фразы в настоящем времени. Без лекции.',
  movement: 'У окна → к зрителю → к столу со стаканом → стул.',
  habits: ['сначала взгляд', 'потом шаг', 'потом слово'],
  knowledge: ['В комнате есть окно, стол, стул и стакан.'],
  memory: 'Я у окна. Свет падает на стол. На столе стакан. Кто-то вошёл в комнату — я должна это увидеть телом.',
  openingSeed: 'Ты тоже это видишь — свет на стекле?',
  homeProp: 'actor_window',
  appearance: { notes: 'тёмные волосы, спокойная куртка', hair: '#171717', clothes: '#28384d' },
  proximity: 1.2,
};

export const PASHA_DEMO_SOURCE = [
  'Комната после дождя. Мара стоит у окна.',
  'Она замечает человека в VR раньше, чем своё отражение.',
  'Делает шаг ближе, указывает на стакан на столе, подходит, берёт его,',
  'садится на стул и снова смотрит на зрителя: «Ты видел это тоже.»',
].join(' ');

export function pashaDemoPack() {
  const character = {
    ...PASHA_DEMO_CHARACTER,
    zone: {
      ...PASHA_DEMO_WORLD,
      objects: PASHA_DEMO_WORLD.objects.map((item) => ({ ...item })),
      homeProp: 'actor_window',
    },
  };
  return {
    ok: true,
    pack: 'pasha-demo',
    title: 'Demo Паша',
    characters: [character],
    world: {
      ...PASHA_DEMO_WORLD,
      objects: PASHA_DEMO_WORLD.objects.map((item) => ({ ...item })),
    },
    source: PASHA_DEMO_SOURCE,
    usedLlm: false,
    how: 'authored-pack',
  };
}
