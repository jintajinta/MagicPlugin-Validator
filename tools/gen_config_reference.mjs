#!/usr/bin/env node
// MagicPlugin のソースから wand / spell / effects の設定キー一覧を生成する。
//   node tools/gen_config_reference.mjs
//
// 出力:
//   reference/wand.md    ... wand テンプレート(杖・武器アイテム定義)のキー
//   reference/spell.md   ... spell 定義・parameters のキー
//   reference/effects.md ... effects: の各エントリのキー(EffectPlayer)と class: の一覧
//
// Action の一覧は gen_action_reference.mjs、effectlib は gen_effectlib_reference.mjs が担当。
//
// 抽出方法: ConfigurationSection から値を読む呼び出しを正規表現で拾う。
//   node.getString("name", default) / ConfigurationUtils.getInteger(node, "name", default)
// 正規表現ベースなので **網羅的だが完全ではない**。確信が要る場合はソースを直接読む。

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = dirname(HERE);
const JAVA = join(DOCS, 'plugin/MagicPlugin/Magic/src/main/java/com/elmakers/mine/bukkit');
// enum 定義は API 側にある
const API = join(DOCS, 'plugin/MagicPlugin/MagicAPI/src/main/java/com/elmakers/mine/bukkit/api');

const TYPE_LABEL = {
  Double: 'double', Int: 'int', Integer: 'int', Boolean: 'boolean', String: 'string',
  Long: 'long', Float: 'float', StringList: 'string[]', IntegerList: 'int[]',
  ConfigurationSection: 'section', List: 'list', Keys: '(keys)', MapList: 'map[]',
  Vector: 'vector', Material: 'material', MaterialBrush: 'brush', Color: 'color',
  Particle: 'particle', Sound: 'sound', PotionEffectType: 'potion_effect',
  Location: 'location', Alternative: 'string', Enum: 'enum', Icon: 'icon',
};

/**
 * 対象ファイルから設定キーを抽出する。
 * receivers: ConfigurationSection を保持している変数名（この変数への get 呼び出しを拾う）
 */
function extract(file, receivers) {
  const text = readFileSync(file, 'utf8');
  const recv = receivers.join('|');
  const found = new Map();
  const add = (name, type, def) => {
    if (found.has(name)) return;
    let d = (def ?? '').replace(/\s+/g, ' ').trim();
    if (d.length > 48) d = d.slice(0, 45) + '...';
    found.set(name, { type: TYPE_LABEL[type] ?? type.toLowerCase(), def: d, src: basename(file) });
  };
  // node.getString("key", default)
  for (const m of text.matchAll(new RegExp(`(?:${recv})\\s*\\.\\s*(?:get|is)(\\w+)\\s*\\(\\s*"([^"]+)"\\s*(?:,\\s*([^;]*?))?\\)`, 'g'))) {
    add(m[2], m[1], m[3]);
  }
  // ConfigurationUtils.getInteger(node, "key", default)
  for (const m of text.matchAll(new RegExp(`ConfigurationUtils\\s*\\.\\s*get(\\w+)\\s*\\(\\s*(?:${recv})\\s*,\\s*"([^"]+)"\\s*(?:,\\s*([^;]*?))?\\)`, 'g'))) {
    add(m[2], m[1], m[3]);
  }
  // node.contains("key")
  for (const m of text.matchAll(new RegExp(`(?:${recv})\\s*\\.\\s*contains\\s*\\(\\s*"([^"]+)"\\s*\\)`, 'g'))) {
    add(m[1], 'Boolean', '');
  }
  // new SourceLocation(configuration, "source_location", ...) のようにキーを引数で渡す形
  for (const m of text.matchAll(new RegExp(`\\(\\s*(?:${recv})\\s*,\\s*"([a-z0-9_]+)"`, 'g'))) {
    add(m[1], 'String', '');
  }
  // contains("a") ? "a" : "b" のようにキーを三項演算子で選ぶ形
  for (const m of text.matchAll(/\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g)) {
    add(m[1], 'String', ''); add(m[2], 'String', '');
  }
  return found;
}

/** 複数ファイルの抽出結果を1つにまとめる（先に出たものを優先し、出典ファイル名を残す） */
function extractAll(files, receivers) {
  const merged = new Map();
  for (const f of files) {
    if (!existsSync(f)) continue;
    for (const [k, v] of extract(f, receivers)) {
      if (!merged.has(k)) merged.set(k, v);
    }
  }
  return merged;
}

function table(map) {
  if (map.size === 0) return ['（抽出できたキーなし）', ''];
  const rows = ['| キー | 型 | デフォルト | 抽出元 |', '|---|---|---|---|'];
  for (const [k, v] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push(`| \`${k}\` | ${v.type} | ${v.def ? `\`${v.def}\`` : '—'} | \`${v.src}\` |`);
  }
  rows.push('');
  return rows;
}

const AUTOGEN = (script) => [
  `> **このファイルは \`tools/${script}\` による自動生成です。手で編集しないこと。**`,
  '> MagicPlugin サブモジュールを更新したら再生成する。',
  '',
  '正規表現によるソース機械抽出なので **網羅的だが完全ではありません**。',
  'また「読まれているキー」を列挙しているだけで、どの階層に書くかはソース/サンプルで確認してください。',
  '',
];

const write = (out, lines) => {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(`wrote ${out}`);
};

/** enum ファイルから定数名を列挙する（yml では小文字で書く） */
function enumValues(file, enumName) {
  if (!existsSync(file)) {
    console.warn(`  ! enum source not found: ${file}`);
    return [];
  }
  const text = readFileSync(file, 'utf8');
  const at = text.indexOf(`enum ${enumName}`);
  if (at < 0) return [];
  const open = text.indexOf('{', at);
  // 定数宣言は最初の `;` まで（メソッド定義の前）。`;` が無い enum は末尾の `}` まで
  const semi = text.indexOf(';', open);
  let body = text.slice(open + 1, semi < 0 ? text.lastIndexOf('}') : semi);
  // コメントとコンストラクタ引数を落としてからカンマ区切りで分解する
  // （`ALT_CAST, ALT_CAST2, ALT_CAST3` のように1行に複数並ぶケースがある）
  body = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\([^()]*\)/g, '');
  return body.split(',').map((s) => s.trim()).filter((s) => /^[A-Z][A-Z0-9_]*$/.test(s));
}

/** ソース全体を走査して playEffects("name") で呼ばれる組み込みセクション名を集める */
function effectSections() {
  const found = new Map(); // name -> 呼び出し元クラスの集合
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.java')) {
        const text = readFileSync(p, 'utf8');
        for (const m of text.matchAll(/playEffects\s*\(\s*"([a-z0-9_]+)"/g)) {
          if (!found.has(m[1])) found.set(m[1], new Set());
          found.get(m[1]).add(basename(p, '.java'));
        }
      }
    }
  };
  walk(JAVA);
  return found;
}

const enumTable = (title, values, note) => {
  const L = [`### ${title}`, ''];
  if (note) L.push(note, '');
  L.push('```');
  L.push(values.map((v) => v.toLowerCase()).join(' / '));
  L.push('```', '');
  return L;
};

// ---------------------------------------------------------------- wand.md
// wand は「有効キーの正解リスト」がソース中に ImmutableSet として明示されているので、
// そちらを一次情報にし、get 呼び出しから型とデフォルトを補う。
{
  /** ImmutableSet.of(...) / Builder.add(...) 内の文字列リテラルを列挙する */
  const keySet = (file, setName) => {
    const text = readFileSync(file, 'utf8');
    const at = text.indexOf(setName);
    if (at < 0) return [];
    // 宣言の終端 `;` までを対象にする
    const end = text.indexOf(';', at);
    const body = text.slice(at, end);
    return [...body.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  };

  const WP = join(JAVA, 'wand/WandProperties.java');
  const BMP = join(JAVA, 'magic/BaseMagicProperties.java');
  const baseKeys = keySet(BMP, 'PROPERTY_KEYS');
  const wandKeys = keySet(WP, 'PROPERTY_KEYS');
  const hiddenKeys = keySet(BMP, 'HIDDEN_PROPERTY_KEYS');

  // 型・デフォルトの補完用（`getString("name", def)` のようなレシーバ無し呼び出しも拾う）
  const enrichFiles = ['wand/Wand.java', 'wand/WandTemplate.java', 'wand/WandLevel.java',
    'wand/RequirementProperties.java', 'magic/BaseMagicProperties.java',
    'magic/BaseMagicConfigurable.java', 'magic/CasterProperties.java'].map((f) => join(JAVA, f));
  const enrich = new Map();
  for (const f of enrichFiles) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, 'utf8');
    // this.getString("k", def) / getString("k", def) / node.getString("k", def) すべて拾う
    for (const m of text.matchAll(/(?:^|[\s.(=])get(\w+)\s*\(\s*"([a-z0-9_]+)"\s*(?:,\s*([^;)]*?))?\)/gm)) {
      if (enrich.has(m[2])) continue;
      let d = (m[3] ?? '').replace(/\s+/g, ' ').trim();
      if (d.length > 40) d = d.slice(0, 37) + '...';
      enrich.set(m[2], { type: TYPE_LABEL[m[1]] ?? m[1].toLowerCase(), def: d, src: basename(f) });
    }
  }

  const row = (k) => {
    const e = enrich.get(k);
    return `| \`${k}\` | ${e?.type ?? '?'} | ${e?.def ? `\`${e.def}\`` : '—'} | ${e ? `\`${e.src}\`` : '—'} |`;
  };
  const head = ['| キー | 型 | デフォルト | 抽出元 |', '|---|---|---|---|'];

  const L = ['# wand（杖・武器アイテム）設定キー リファレンス（自動生成）', '', ...AUTOGEN('gen_config_reference.mjs')];
  L.push('`wands/<name>/<name>_wand.yml` のトップレベル（杖テンプレート名の直下）に書くキーです。');
  L.push('公式の説明は');
  L.push('`plugin/MagicPlugin/Magic/WANDS.md`（ただし TODO 多数で不完全）。');
  L.push('');
  L.push('**有効キーの一覧はソース中に明示されています**（`WandProperties.PROPERTY_KEYS` /');
  L.push('`BaseMagicProperties.PROPERTY_KEYS`）。ここに無いキーは基本的に無視されます。');
  L.push('型とデフォルトは `get*()` 呼び出しから拾った補足情報で、`?` は機械抽出できなかったもの。');
  L.push('');
  L.push('この他に、テンプレート共通の `name` / `lore` / `description` / `inherit` / `creator` /');
  L.push('`creator_id` が使えます。');
  L.push('');
  L.push(`## wand 固有プロパティ（${wandKeys.length - baseKeys.length}件）`);
  L.push('');
  L.push(...head);
  for (const k of wandKeys.filter((k) => !baseKeys.includes(k)).sort()) L.push(row(k));
  L.push('');
  L.push(`## 共通プロパティ（BaseMagicProperties・${baseKeys.length}件）`);
  L.push('');
  L.push('wand / クラス / パス で共通のプロパティ。マナ関係もここ。');
  L.push('');
  L.push(...head);
  for (const k of [...baseKeys].sort()) L.push(row(k));
  L.push('');
  L.push(`## 内部用（HIDDEN_PROPERTY_KEYS・${hiddenKeys.length}件）`);
  L.push('');
  L.push('プラグインが内部管理に使うキー。**yml に手で書かない。**');
  L.push('');
  L.push(...head);
  for (const k of [...hiddenKeys].sort()) L.push(row(k));
  L.push('');
  L.push('## enum 値');
  L.push('');
  const wandActions = enumValues(join(API, 'wand/WandAction.java'), 'WandAction');
  L.push(...enumTable('WandAction — `left_click` / `right_click` / `drop` / `swap` / `*_sneak` に指定する値',
    wandActions,
    '`alt_cast` は `alternate_spell`、`alt_cast2` は `alternate_spell2` … を発動する（`alt_cast7` まで）。'));
  write(join(DOCS, 'reference/wand.md'), L);

  // validate.mjs 用（テンプレート共通キーは PROPERTY_KEYS に無いので足す）
  const TEMPLATE_KEYS = ['name', 'lore', 'description', 'inherit', 'creator', 'creator_id',
    'enabled', 'hidden', 'upgrade_description'];
  writeFileSync(join(DOCS, 'reference/wand.enum.json'), JSON.stringify({
    _generated_by: 'tools/gen_config_reference.mjs',
    property_keys: [...new Set([...wandKeys, ...baseKeys, ...TEMPLATE_KEYS])].sort(),
    hidden_keys: hiddenKeys.sort(),
    // クリック割り当てキー -> 指定できる WandAction（yml では小文字）
    action_slots: ['left_click', 'right_click', 'drop', 'swap', 'no_bowpull',
      'left_click_sneak', 'right_click_sneak', 'drop_sneak', 'swap_sneak', 'no_bowpull_sneak'],
    wand_actions: wandActions.map((v) => v.toLowerCase()),
  }, null, 2), 'utf8');
  console.log(`wrote ${join(DOCS, 'reference/wand.enum.json')}`);
}

// --------------------------------------------------------------- spell.md
{
  const files = ['spell/BaseSpell.java', 'spell/ActionSpell.java', 'spell/TargetingSpell.java',
    'spell/BlockSpell.java', 'spell/BrushSpell.java', 'spell/UndoableSpell.java',
    'spell/TriggeredSpell.java', 'spell/CastingCost.java', 'action/ActionHandler.java',
    'action/BaseSpellAction.java',
    // 共通のターゲティングパラメータ（range / radius / close_range / fov など）はここが本体
    'utility/Targeting.java', 'magic/SourceLocation.java'].map((f) => join(JAVA, f));
  const keys = extractAll(files, ['parameters', 'configuration', 'node', 'template', 'section', 'costNode']);
  const L = ['# spell 設定キー リファレンス（自動生成）', '', ...AUTOGEN('gen_config_reference.mjs')];
  L.push('spell 定義（`<name>_spells.yml` 相当）と、その `parameters:` に書けるキーです。');
  L.push('公式の説明（共通パラメータの表・使用例）は `plugin/MagicPlugin/Magic/SPELLS.md` にもあります。');
  L.push('個々の Action のパラメータは `reference/actions.md` を参照。');
  L.push('');
  L.push(`抽出キー数: ${keys.size}`);
  L.push('');
  L.push(...table(keys));
  L.push('## enum 値');
  L.push('');
  L.push(...enumTable('TargetType — `parameters.target` に指定する値',
    enumValues(join(API, 'spell/TargetType.java'), 'TargetType'),
    '`self` は自分自身、`block` はブロック、`any` はエンティティ+ブロック、`other` は自分以外。'));
  const targetTypes = enumValues(join(API, 'spell/TargetType.java'), 'TargetType');
  const spellResults = enumValues(join(API, 'spell/SpellResult.java'), 'SpellResult');
  L.push(...enumTable('SpellResult — spell の実行結果。`effects:` のセクション名としても使える',
    spellResults,
    '例: `effects: { cast: [...], fizzle: [...], no_target: [...] }`'));
  write(join(DOCS, 'reference/spell.md'), L);

  // validate.mjs 用
  const SPELL_TOP_KEYS = ['name', 'description', 'icon', 'icon_url', 'icon_disabled', 'category',
    'actions', 'effects', 'parameters', 'costs', 'active_costs', 'inherit', 'enabled', 'hidden',
    'creator', 'creator_id', 'upgrade_required_casts', 'upgrade_description', 'levels',
    'worth', 'earns', 'earns_cooldown', 'tags', 'quick_cast', 'passive', 'template'];
  writeFileSync(join(DOCS, 'reference/spell.enum.json'), JSON.stringify({
    _generated_by: 'tools/gen_config_reference.mjs',
    top_keys: SPELL_TOP_KEYS.sort(),
    parameter_keys: [...keys.keys()].sort(),
    target_types: targetTypes.map((v) => v.toLowerCase()),
    spell_results: spellResults.map((v) => v.toLowerCase()),
  }, null, 2), 'utf8');
  console.log(`wrote ${join(DOCS, 'reference/spell.enum.json')}`);
}

// -------------------------------------------------------------- effects.md
{
  const builtinDir = join(JAVA, 'effect/builtin');
  const builtins = readdirSync(builtinDir).filter((f) => f.endsWith('.java')).sort();
  const files = [join(JAVA, 'effect/EffectPlayer.java'), join(JAVA, 'effect/SoundEffect.java'),
    // source_location / target_location は SourceLocation のコンストラクタ経由で読まれる
    join(JAVA, 'magic/SourceLocation.java'),
    ...builtins.map((f) => join(builtinDir, f))];
  if (!existsSync(join(JAVA, 'magic/SourceLocation.java'))) {
    console.warn('  ! magic/SourceLocation.java が見つからない（source_location 等が抜けます）');
  }
  const keys = extractAll(files, ['configuration', 'effectValues', 'node', 'parameters', 'section']);

  const L = ['# effects（演出）設定キー リファレンス（自動生成）', '', ...AUTOGEN('gen_config_reference.mjs')];
  L.push('spell の `effects:` 配下の各エントリに書けるキーです。');
  L.push('`effectlib:` ブロック内のパラメータは別ファイル → `reference/effectlib.md`。');
  L.push('');
  L.push('## `class:` に指定できる EffectPlayer クラス');
  L.push('');
  L.push('| `class:` | ソース |');
  L.push('|---|---|');
  for (const f of builtins) {
    const cls = basename(f, '.java');
    L.push(`| \`${cls}\`${cls === 'EffectSingle' ? '（省略時のデフォルト）' : ''} | \`effect/builtin/${f}\` |`);
  }
  L.push('');
  L.push('## エントリのキー');
  L.push('');
  L.push(`抽出キー数: ${keys.size}`);
  L.push('');
  L.push(...table(keys));

  L.push('## `effects:` のセクション名');
  L.push('');
  L.push('`effects:` 直下のキーがセクション名で、対応するタイミングで再生されます。');
  L.push('種類は3つ:');
  L.push('');
  L.push('1. **SpellResult 名**（`cast` / `fizzle` / `no_target` など）→ `reference/spell.md` の enum 値を参照');
  L.push('2. **Action が明示的に再生する名前**（下表）— 使う Action 次第で有効なものが決まる');
  L.push('3. **任意の名前** — `PlayEffects` Action の `effects:` から呼び出す');

  L.push('');
  L.push('### Action / 内部処理が再生するセクション名');
  L.push('');
  L.push('| セクション名 | 再生元クラス |');
  L.push('|---|---|');
  const sections = effectSections();
  for (const name of [...sections.keys()].sort()) {
    L.push(`| \`${name}\` | ${[...sections.get(name)].sort().map((c) => `\`${c}\``).join(', ')} |`);
  }
  L.push('');
  write(join(DOCS, 'reference/effects.md'), L);

  // validate.mjs 用
  writeFileSync(join(DOCS, 'reference/effects.enum.json'), JSON.stringify({
    _generated_by: 'tools/gen_config_reference.mjs',
    entry_keys: [...keys.keys()].sort(),
    player_classes: builtins.map((f) => basename(f, '.java')),
    builtin_sections: [...sections.keys()].sort(),
  }, null, 2), 'utf8');
  console.log(`wrote ${join(DOCS, 'reference/effects.enum.json')}`);
}
