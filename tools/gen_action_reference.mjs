#!/usr/bin/env node
// MagicPlugin のソースから Action リファレンス(reference/actions.md)を生成する。
// MagicPlugin サブモジュールを更新したら再実行すること:
//   node tools/gen_action_reference.mjs
//
// 抽出しているもの:
//   - Action クラス名 → yml で `class:` に書く名前(末尾 Action を除いたもの)
//   - extends している親クラス(親のパラメータも継承される)
//   - parameters.getXxx("name", default) / ConfigurationUtils.getXxx(parameters, "name", default)
//     の呼び出しから、パラメータ名・型・デフォルト値
//
// 注意: 正規表現ベースの機械抽出なので「網羅的だが完全ではない」。
// デフォルト値が変数や式の場合はその式をそのまま出す。確信が要る場合はソースを直接読む。

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = dirname(HERE);
const SRC = join(DOCS, 'plugin/MagicPlugin/Magic/src/main/java/com/elmakers/mine/bukkit/action');
const OUT = join(DOCS, 'reference/actions.md');

// parameters.getDouble("radius", 8) 形式
const RE_PARAM = /parameters\s*\.\s*get(\w+)\s*\(\s*"([^"]+)"\s*(?:,\s*([^;]*?))?\)/g;
// ConfigurationUtils.getDouble(parameters, "radius", 8) 形式
const RE_CONFIGUTIL = /ConfigurationUtils\s*\.\s*get(\w+)\s*\(\s*parameters\s*,\s*"([^"]+)"\s*(?:,\s*([^;]*?))?\)/g;
// parameters.contains("x") — 存在チェックのみで読まれるキー
const RE_CONTAINS = /parameters\s*\.\s*contains\s*\(\s*"([^"]+)"\s*\)/g;
// new SourceLocation(parameters, "source_location", ...) のようにキー名を引数で渡す形
const RE_ARG_KEY = /\(\s*(?:parameters|configuration)\s*,\s*"([a-z0-9_]+)"/g;
// parameters.contains("a") ? "a" : "b" のようにキーを三項演算子で選ぶ形
const RE_TERNARY_KEY = /\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g;
const RE_CLASS = /(?:public\s+|abstract\s+|final\s+)*class\s+(\w+)\s+extends\s+(\w+)/;

const TYPE_LABEL = {
  Double: 'double', Int: 'int', Integer: 'int', Boolean: 'boolean', String: 'string',
  Long: 'long', Float: 'float', StringList: 'string[]', IntegerList: 'int[]',
  ConfigurationSection: 'section', List: 'list', Keys: '(keys)',
  Vector: 'vector', Material: 'material', MaterialBrush: 'brush', Color: 'color',
  Particle: 'particle', Sound: 'sound', PotionEffectType: 'potion_effect',
  Location: 'location', Alternative: 'string', Enum: 'enum',
};

/** デフォルト値の式を1行に丸める。長すぎるものは切る。 */
function tidyDefault(raw) {
  if (raw === undefined || raw === null) return '';
  let d = raw.replace(/\s+/g, ' ').trim();
  // 末尾に他の引数が続いてしまったケースを軽く救済
  if (d.length > 60) d = d.slice(0, 57) + '...';
  return d;
}

function collect(text) {
  const found = new Map(); // name -> {type, def}
  const add = (name, type, def) => {
    if (!found.has(name)) found.set(name, { type: TYPE_LABEL[type] ?? type.toLowerCase(), def: tidyDefault(def) });
  };
  for (const m of text.matchAll(RE_PARAM)) add(m[2], m[1], m[3]);
  for (const m of text.matchAll(RE_CONFIGUTIL)) add(m[2], m[1], m[3]);
  for (const m of text.matchAll(RE_CONTAINS)) add(m[1], 'Boolean', '');
  for (const m of text.matchAll(RE_ARG_KEY)) add(m[1], 'String', '');
  for (const m of text.matchAll(RE_TERNARY_KEY)) { add(m[1], 'String', ''); add(m[2], 'String', ''); }
  return found;
}

function parse(file, relDir) {
  const text = readFileSync(file, 'utf8');
  const cls = text.match(RE_CLASS);
  const name = cls ? cls[1] : basename(file, '.java');
  return {
    className: name,
    // yml の class: に書く名前。Magic は末尾 Action を省略した名前で解決する
    actionName: name.endsWith('Action') ? name.slice(0, -6) : name,
    parent: cls ? cls[2] : '',
    isAbstract: /\babstract\s+class\b/.test(text),
    params: collect(text),
    path: `${relDir}/${basename(file)}`,
  };
}

const baseFiles = readdirSync(SRC).filter((f) => f.endsWith('.java'));
const builtinFiles = readdirSync(join(SRC, 'builtin')).filter((f) => f.endsWith('.java'));

const bases = baseFiles.map((f) => parse(join(SRC, f), 'action')).sort((a, b) => a.className.localeCompare(b.className));
const actions = builtinFiles.map((f) => parse(join(SRC, 'builtin', f), 'action/builtin')).sort((a, b) => a.actionName.localeCompare(b.actionName));

const byClass = new Map([...bases, ...actions].map((a) => [a.className, a]));

/** 親をたどって継承チェーンを出す(このリポジトリ内で解決できる分だけ) */
function chain(a) {
  const out = [];
  let p = a.parent;
  const seen = new Set();
  while (p && byClass.has(p) && !seen.has(p)) {
    seen.add(p);
    out.push(p);
    p = byClass.get(p).parent;
  }
  if (p && !byClass.has(p)) out.push(p);
  return out;
}

const L = [];
L.push('# Magic Action リファレンス（自動生成）');
L.push('');
L.push('> **このファイルは `tools/gen_action_reference.mjs` による自動生成です。手で編集しないこと。**');
L.push('> MagicPlugin サブモジュールを更新したら `node tools/gen_action_reference.mjs` で再生成する。');
L.push('');
L.push('spell の `actions:` に書く `class:` の一覧と、各 Action がソース上で読んでいるパラメータです。');
L.push('正規表現による機械抽出なので **網羅的だが完全ではありません**。挙動に確信が要る場合は');
L.push('`plugin/MagicPlugin/Magic/src/main/java/com/elmakers/mine/bukkit/` の該当クラスを直接読んでください。');
L.push('');
L.push('- `class:` には末尾の `Action` を除いた名前を書く（例: `AreaOfEffectAction` → `class: AreaOfEffect`）');
L.push('- **継承** 列の親クラスのパラメータも使えます（親の定義は「基底クラス」節を参照）');
L.push('- デフォルト値が式・変数のものはその式をそのまま載せています');
L.push('');
L.push(`生成元: MagicPlugin / Action ${actions.length}件・基底クラス ${bases.length}件`);
L.push('');

L.push('## 目次（Action 一覧）');
L.push('');
L.push('| `class:` | 継承 | パラメータ数 |');
L.push('|---|---|---|');
for (const a of actions) {
  const anchor = a.actionName.toLowerCase();
  L.push(`| [\`${a.actionName}\`](#${anchor}) | ${chain(a).join(' → ') || '-'} | ${a.params.size} |`);
}
L.push('');

function paramTable(a) {
  if (a.params.size === 0) return ['（このクラス自身が読むパラメータは無し。継承元を参照）', ''];
  const rows = ['| パラメータ | 型 | デフォルト |', '|---|---|---|'];
  for (const [name, { type, def }] of [...a.params.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    rows.push(`| \`${name}\` | ${type} | ${def ? `\`${def}\`` : '—'} |`);
  }
  rows.push('');
  return rows;
}

L.push('## 基底クラス（共通パラメータ）');
L.push('');
L.push('各 Action が継承しているクラス。ここのパラメータは継承先の Action でもそのまま使えます。');
L.push('');
for (const b of bases) {
  L.push(`### ${b.className}`);
  L.push('');
  L.push(`継承: ${chain(b).join(' → ') || '-'} ／ ソース: \`${b.path}\``);
  L.push('');
  L.push(...paramTable(b));
}

L.push('## Action 詳細');
L.push('');
for (const a of actions) {
  L.push(`### ${a.actionName}`);
  L.push('');
  L.push(`\`class: ${a.actionName}\`${a.isAbstract ? '（abstract: 直接は使えない）' : ''}`);
  L.push('');
  L.push(`継承: ${chain(a).join(' → ') || '-'} ／ ソース: \`${a.path}\``);
  L.push('');
  L.push(...paramTable(a));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(`wrote ${OUT}`);

// validate.mjs が読む機械可読版も出す
const ENUM_OUT = join(DOCS, 'reference/actions.enum.json');
const enumData = {
  _generated_by: 'tools/gen_action_reference.mjs',
  // class: に書ける名前 -> そのクラス自身が読むパラメータ名
  actions: Object.fromEntries(actions.map((a) => [a.actionName, [...a.params.keys()].sort()])),
  // 継承チェーン（親のパラメータも有効）
  inherits: Object.fromEntries(actions.map((a) => [a.actionName, chain(a)])),
  // クラス名 -> パラメータ。継承チェーンを辿るときに引く。
  // builtin/ にも VolumeAction のような中間クラスがあるので、基底も Action も同じ表に入れる
  params_by_class: Object.fromEntries(
    [...bases, ...actions].map((c) => [c.className, [...c.params.keys()].sort()]),
  ),
  // 基底クラスのパラメータ（人間が読む用に残す）
  bases: Object.fromEntries(bases.map((b) => [b.className, [...b.params.keys()].sort()])),
  // abstract は class: に書けない
  abstract: actions.filter((a) => a.isAbstract).map((a) => a.actionName),
};
writeFileSync(ENUM_OUT, JSON.stringify(enumData, null, 2), 'utf8');
console.log(`wrote ${ENUM_OUT}`);
console.log(`  actions: ${actions.length}, bases: ${bases.length}`);
console.log(`  params total: ${actions.reduce((n, a) => n + a.params.size, 0)}`);
