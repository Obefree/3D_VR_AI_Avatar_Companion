#!/usr/bin/env node
/** Build dataset + create Ollama model `nova-prince` (GPU/CPU via Ollama). */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function findOllama() {
  const candidates = [
    process.env.OLLAMA_BIN,
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    'ollama',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'ollama') return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'ollama';
}

function run(cmd, args) {
  console.log('>', cmd, args.join(' '));
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}

run(process.execPath, [path.join('tools', 'train', 'build-dataset.mjs')]);
run(findOllama(), ['create', 'nova-prince', '-f', path.join('tools', 'train', 'Modelfile')]);
console.log('Model nova-prince ready. Dataset: tools/train/prince-dataset.jsonl');
