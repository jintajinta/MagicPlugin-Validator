#!/usr/bin/env node
// MagicPlugin の wand / spell YAML を検証する CLI。
//
//   node bin/validate.mjs <file-or-dir> [...]     指定が無ければカレントディレクトリ
//   node bin/validate.mjs --level=2 wands/        深刻なものだけ（既定は 4 = 全部）
//
// wand / spell の判別はファイル名ではなく中身で行う（actions: 等を持てば spell）。
//
// 出力は深刻度4段階。--level=N で N 以下だけ表示する。
//   1 ✗ エラー  存在しない enum / 無効キー / 構造エラー。その行は確実に効かない
//   2 ⚠ 重要    構文は正しいのに黙って実害が出る。エラーが出ないぶんこちらが危険
//   3 ! 警告    タイポの疑い、または推奨から外れている
//   4 · 未確認  このツールでは正誤を判断できなかった行。ソースを見て有効なら無視してよい
// 終了コードは エラー+重要 が 0 件なら 0、あれば 1。

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { load } from '../vendor/js-yaml.mjs';
import { validate, LEVELS, LEVEL_LABEL } from '../src/validator.js';
import { REFERENCE } from '../src/reference.js';

const argv = process.argv.slice(2);
const levelArg = argv.find((a) => a.startsWith('--level='));
const maxLevel = levelArg ? Math.max(1, Math.min(4, Number(levelArg.split('=')[1]) || 4)) : 4;
const targets = argv.filter((a) => !a.startsWith('--'));
if (targets.length === 0) targets.push('.');

/** .yml / .yaml を再帰的に集める */
function collectYaml(target) {
  const st = statSync(target);
  if (st.isFile()) return /\.ya?ml$/.test(target) ? [target] : [];
  const out = [];
  for (const e of readdirSync(target, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(target, e.name);
    if (e.isDirectory()) out.push(...collectYaml(p));
    else if (/\.ya?ml$/.test(e.name)) out.push(p);
  }
  return out;
}

const paths = [];
for (const t of targets) {
  if (!existsSync(t)) {
    console.error(`対象が見つかりません: ${t}`);
    process.exit(2);
  }
  paths.push(...collectYaml(t));
}
const files = [...new Set(paths)].sort()
  .map((p) => ({ name: relative('.', p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));

if (files.length === 0) {
  console.log(`検証対象の .yml がありません: ${targets.join(' ')}`);
  process.exit(0);
}

const problems = validate(files, REFERENCE, load);
// ファイルごとに、上から順に直していけるよう行番号順に並べる
const inOrder = (a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0);
const byLevel = LEVELS.map((lv) => problems.filter((p) => p.level === lv).sort(inOrder));

const show = (list, label, mark) => {
  if (list.length === 0) return;
  console.log('');
  console.log(`${mark} ${label} (${list.length})`);
  let last = null;
  for (const p of list) {
    if (p.file !== last) {
      console.log('');
      console.log(`  ${p.file}`);
      last = p.file;
    }
    console.log(`    ${p.line ? `${p.line}行目 ` : ''}${p.path}`);
    console.log(`      ${p.msg}`);
    if (p.hint) console.log(`      → ${p.hint}`);
  }
};

console.log(`検証: ${files.length} ファイル`);
LEVELS.forEach((lv, i) => {
  if (i + 1 > maxLevel) return;
  const [mark, label] = LEVEL_LABEL[lv];
  show(byLevel[i], label, mark);
});

console.log('');
if (problems.length === 0) {
  console.log('✓ 問題なし');
} else {
  console.log(LEVELS.map((lv, i) => `${LEVEL_LABEL[lv][1].split('（')[0]} ${byLevel[i].length}`).join(' / '));
  const shown = byLevel.slice(0, maxLevel).reduce((a, b) => a + b.length, 0);
  if (problems.length > shown) {
    console.log(`（--level=${maxLevel} のため ${problems.length - shown} 件は非表示。全部見るなら --level=4）`);
  }
  if (byLevel[1].length > 0) {
    console.log('⚠ 重要 は「エラーにならないまま実害が出る」もの。エラーと同じ扱いで潰すこと。');
  }
}

process.exit(byLevel[0].length + byLevel[1].length > 0 ? 1 : 0);
