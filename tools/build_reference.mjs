#!/usr/bin/env node
// reference/ の生成物をまとめて src/reference.js（ブラウザ/CLI が読む1ファイル）にする。
//
//   node tools/build_reference.mjs
//
// 入力:
//   reference/*.enum.json  ... gen_action_reference / gen_effectlib_reference / gen_config_reference の出力
//   reference/*.txt        ... Paper の enum ダンプ（particles / sounds / materials）
// 出力:
//   src/reference.js

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REF = join(ROOT, 'reference');

const readJson = (f) => JSON.parse(readFileSync(join(REF, f), 'utf8'));
const readList = (f) => readFileSync(join(REF, f), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean);

const REFERENCE = {
  actions: readJson('actions.enum.json'),
  effectlib: readJson('effectlib.enum.json'),
  wand: readJson('wand.enum.json'),
  spell: readJson('spell.enum.json'),
  effects: readJson('effects.enum.json'),
  particles: readList('particles.txt'),
  sounds: readList('sounds.txt'),
  materials: readList('materials.txt'),
};

const out = `// 自動生成物。手で編集しない（node tools/build_reference.mjs で再生成する）。
//   actions / effectlib / wand / spell / effects ... MagicPlugin・EffectLib のソースから抽出
//   particles / sounds / materials              ... Paper 1.21.8 の enum
export const REFERENCE = ${JSON.stringify(REFERENCE)};
`;
writeFileSync(join(ROOT, 'src/reference.js'), out);

const counts = [
  `Action ${Object.keys(REFERENCE.actions.actions).length}`,
  `EffectLib ${Object.keys(REFERENCE.effectlib.classes).length}`,
  `Particle ${REFERENCE.particles.length}`,
  `Sound ${REFERENCE.sounds.length}`,
  `Material ${REFERENCE.materials.length}`,
];
console.log(`wrote src/reference.js (${out.length} bytes) — ${counts.join(' / ')}`);
