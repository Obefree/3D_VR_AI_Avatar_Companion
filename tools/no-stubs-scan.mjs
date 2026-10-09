/** Fail if user-visible stubs / canned "search a line" copy remain in Stage product files. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'src/stage-app.js',
  'api/chat.js',
  'index.html',
  'src/cinematic-director.js',
  'scenario/packs/tv-demo.mjs',
  'scenario/packs/pasha-demo.mjs',
  'scenario/packs/little-prince.mjs',
];

const banned = [
  { re: /не нашёл реплику|не нашел реплику/i, why: 'canned miss-line stub' },
  { re: /Я тебя слышу\.?\s*Скажи ещё/i, why: 'echo bait stub' },
  { re: /Повтори коротко/i, why: 'canned retry stub' },
  { re: /proof only/i, why: 'checklist stub UX' },
  { re: /Жёсткий прогон/i, why: 'scripted run stub' },
  { re: /Прогон Паша/i, why: 'scripted pasha checklist UX' },
  { re: /модель молчит/i, why: 'fake silence copy' },
  { re: /занята — скажу/i, why: 'queued-stub copy' },
  { re: /Тестовая заглушка/i, why: 'explicit stub' },
  { re: /tvChecklistPlan|pashaChecklistPlan|runChecklist\s*\(|runPashaChecklist\s*\(/, why: 'scripted checklist stub' },
  { re: /text:\s*seed\b/, why: 'recited openingSeed stub' },
];

let hits = 0;
for (const rel of files) {
  const text = readFileSync(join(root, rel), 'utf8');
  for (const rule of banned) {
    const m = text.match(rule.re);
    if (m) {
      hits += 1;
      const line = text.slice(0, m.index).split(/\n/).length;
      console.error(`STUB ${rel}:${line}  [${rule.why}]  ${m[0]}`);
    }
  }
}

if (hits) {
  console.error(`no-stubs-scan: ${hits} hit(s)`);
  process.exit(1);
}
console.log('no-stubs-scan: ok');
