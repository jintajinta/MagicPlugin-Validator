#!/usr/bin/env node
// EffectLib のソースから effectlib リファレンス(reference/effectlib.md)を生成する。
//   node tools/gen_effectlib_reference.mjs
//
// Magic の effects: 配下で `effectlib: { class: Circle, ... }` と書いたときに指定できる
// クラス名とパラメータの一覧。EffectLib は public フィールドに reflection で値を入れる方式なので、
// **public フィールド = yml のパラメータ** になる。
// yml では snake_case で書く（`enableRotation` → `enable_rotation`）。
//
// 入力: plugin/effectlib-10.12-src/  (EffectLib-10.12-sources.jar を展開したもの)

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = dirname(HERE);
const SRC = join(DOCS, 'plugin/effectlib-10.12-src/de/slikey/effectlib');
const OUT = join(DOCS, 'reference/effectlib.md');

// public double xRotation, yRotation, zRotation = 0;  ← 複数宣言・初期値ありに対応
const RE_FIELD = /^[ \t]*public\s+(?!class|static\s+final|abstract)((?:final\s+)?[\w<>\[\],.? ]+?)\s+([\w$]+(?:\s*,\s*[\w$]+)*)\s*(?:=\s*([^;]+?))?\s*;/gm;
const RE_CLASS = /public\s+(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/;
// 直前の javadoc / 行コメントを説明として拾う
const RE_DOC = /\/\*\*([\s\S]*?)\*\//g;

const camelToSnake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase();

/** javadoc を「終了文字位置 → 本文」で列挙する（フィールドとの対応は近接判定で行う） */
function docIndex(text) {
  const docs = [];
  for (const m of text.matchAll(RE_DOC)) {
    const body = m[1].split('\n').map((l) => l.replace(/^\s*\*?\s?/, '').trim()).filter(Boolean).join(' ');
    if (body) docs.push({ end: m.index + m[0].length, body });
  }
  return docs;
}

/** 位置 pos の直前にある javadoc（間が空白のみ）を返す */
function docFor(docs, text, pos) {
  for (let i = docs.length - 1; i >= 0; i--) {
    if (docs[i].end <= pos && /^\s*$/.test(text.slice(docs[i].end, pos))) return docs[i].body;
    if (docs[i].end <= pos) return '';
  }
  return '';
}

function parse(file) {
  const text = readFileSync(file, 'utf8');
  const cls = text.match(RE_CLASS);
  const className = cls ? cls[1] : basename(file, '.java');
  const docs = docIndex(text);
  const fields = [];
  for (const m of text.matchAll(RE_FIELD)) {
    const type = m[1].replace(/\bfinal\b/, '').trim();
    const names = m[2].split(',').map((s) => s.trim());
    const def = (m[3] ?? '').replace(/\s+/g, ' ').trim();
    // 宣言行の先頭（インデント含まない位置）から直前の javadoc を引く
    const desc = docFor(docs, text, m.index + m[0].search(/\S/));
    // 複数宣言 `double a, b, c = 0;` の初期値は最後の変数にしか付かない
    names.forEach((n, i) => {
      fields.push({
        key: camelToSnake(n), field: n, type,
        def: i === names.length - 1 ? def : '',
        desc: i === 0 ? desc : '',
      });
    });
  }
  return {
    className,
    // yml の class: に書く名前。EffectLib は末尾 Effect を省略した名前でも解決する
    ymlName: className.endsWith('Effect') && className !== 'Effect' ? className.slice(0, -6) : className,
    parent: cls?.[2] ?? '',
    isAbstract: /public\s+abstract\s+class/.test(text),
    fields,
    path: file.slice(file.indexOf('effectlib-10.12-src')).replace(/\\/g, '/'),
  };
}

const base = parse(join(SRC, 'Effect.java'));
const effects = readdirSync(join(SRC, 'effect'))
  .filter((f) => f.endsWith('.java'))
  .map((f) => parse(join(SRC, 'effect', f)))
  .sort((a, b) => a.ymlName.localeCompare(b.ymlName));

const L = [];
L.push('# EffectLib リファレンス（自動生成 / EffectLib 10.12）');
L.push('');
L.push('> **このファイルは `tools/gen_effectlib_reference.mjs` による自動生成です。手で編集しないこと。**');
L.push('');
L.push('spell の `effects:` で `effectlib:` ブロックを書くときに使えるクラスとパラメータです。');
L.push('');
L.push('```yaml');
L.push('effects:');
L.push('  cast:');
L.push('  - location: origin');
L.push('    effectlib:');
L.push('      class: Circle          # ← 下記の一覧から。末尾の Effect は省略可');
L.push('      radius: 2');
L.push('      particle: redstone');
L.push('      enable_rotation: false # ← public フィールド enableRotation の snake_case');
L.push('```');
L.push('');
L.push('- **パラメータ名は public フィールドの snake_case**（`enableRotation` → `enable_rotation`）。camelCase でも通るが snake_case で書く。');
L.push('- `Effect`（基底クラス）のパラメータは **全クラスで共通**。`iterations` / `period` / `particle` / `color` などはここ。');
L.push('- `particle:` に入れる名前は Bukkit の Particle enum（`reference/particles.txt` で実在確認）。');
L.push('- `ModifiedEffect`（`class: Modified`）は `parameters:` に数式を書いて別 effect を動的に変化させる特殊クラス。');
L.push('');
L.push(`収録: 基底クラス Effect ／ Effect クラス ${effects.length}件`);
L.push('');

L.push('## クラス一覧');
L.push('');
L.push('| `class:` | パラメータ数 |');
L.push('|---|---|');
for (const e of effects) L.push(`| [\`${e.ymlName}\`](#${e.ymlName.toLowerCase()}) | ${e.fields.length} |`);
L.push('');

function table(e) {
  if (e.fields.length === 0) return ['（固有パラメータなし。基底 Effect のみ）', ''];
  const rows = ['| パラメータ | 型 | デフォルト | 説明 |', '|---|---|---|---|'];
  for (const f of e.fields) {
    const desc = f.desc.replace(/\|/g, '\\|');
    rows.push(`| \`${f.key}\` | ${f.type} | ${f.def ? `\`${f.def}\`` : '—'} | ${desc} |`);
  }
  rows.push('');
  return rows;
}

L.push('## 基底クラス Effect（全 effectlib 共通パラメータ）');
L.push('');
L.push(`ソース: \`${base.path}\``);
L.push('');
L.push(...table(base));

L.push('## Effect クラス詳細');
L.push('');
for (const e of effects) {
  L.push(`### ${e.ymlName}`);
  L.push('');
  L.push(`\`class: ${e.ymlName}\`（${e.className}）${e.isAbstract ? ' — abstract: 直接は使えない' : ''}`);
  L.push('');
  L.push(`継承: ${e.parent || '-'} ／ ソース: \`${e.path}\``);
  L.push('');
  L.push(...table(e));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(`wrote ${OUT}`);

// validate.mjs が読む機械可読版も出す
const ENUM_OUT = join(DOCS, 'reference/effectlib.enum.json');
writeFileSync(ENUM_OUT, JSON.stringify({
  _generated_by: 'tools/gen_effectlib_reference.mjs',
  // 末尾 Effect 省略形 / フル名の両方を受け付ける
  classes: Object.fromEntries(effects.flatMap((e) => {
    const keys = [...new Set([e.ymlName, e.className])];
    return keys.map((k) => [k, e.fields.map((f) => f.key).sort()]);
  })),
  base: base.fields.map((f) => f.key).sort(),
  abstract: effects.filter((e) => e.isAbstract).map((e) => e.ymlName),
}, null, 2), 'utf8');
console.log(`wrote ${ENUM_OUT}`);
console.log(`  effects: ${effects.length}, base fields: ${base.fields.length}`);
console.log(`  fields total: ${effects.reduce((n, e) => n + e.fields.length, 0)}`);
