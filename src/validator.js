// MagicPlugin の wand / spell YAML 検証コア。ブラウザと Node の両方から使う。
//
// 判定内容は全て MagicPlugin / EffectLib のソースで裏を取ってある。
// 環境依存（リソースパックの CustomModelData、カスタム音）の判定は持たない。

export const LEVELS = ['error', 'major', 'warn', 'note'];
export const LEVEL_LABEL = {
  error: ['✗', 'エラー（確実に効かない）'],
  major: ['⚠', '重要（構文は通るが実害が出る）'],
  warn: ['!', '警告（タイポ・推奨違反の疑い）'],
  note: ['·', '補足（抽出漏れかもしれない）'],
};

/**
 * @param {{name: string, text: string}[]} files 検証する YAML
 * @param {object} ref  reference.js の REFERENCE
 * @param {(text: string) => any} parseYaml  YAML パーサ（js-yaml の load を渡す）
 * @returns {{level: string, file: string, path: string, msg: string, hint?: string}[]}
 */
export function validate(files, ref, parseYaml) {
  const toSet = (v) => (v instanceof Set ? v : new Set(v));
  const ACTIONS = ref.actions;
  const EFFECTLIB = ref.effectlib;
  const WAND = ref.wand;
  const SPELL = ref.spell;
  const EFFECTS = ref.effects;
  const PARTICLES = toSet(ref.particles);
  const SOUNDS = toSet(ref.sounds);
  const MATERIALS = toSet(ref.materials);

  // spell の parameters: は全 Action に渡されるので、どの Action のパラメータでも書ける
  const ANY_ACTION_PARAM = new Set([
    ...Object.values(ACTIONS.actions).flat(),
    ...Object.values(ACTIONS.params_by_class).flat(),
  ]);

  // 深刻度は4段階。上ほど「確実におかしい」。
  //   1 error   その行は確実に効かない（存在しない enum / 無効キー / 構造エラー）
  //   2 major   構文は正しいのに黙って実害が出る（耐久で壊れる / 値が切り捨てられる / 併記が無視される）
  //             ★エラーが出ないので気付けない。Magic で一番事故るのはここ
  //   3 warn    タイポの疑い、または推奨から外れている
  //   4 note    機械抽出の網羅漏れかもしれない。ソースを見て問題なければ無視してよい
  const problems = [];
  const report = (level, file, path, msg, hint) =>
    problems.push({ level, file, path, msg, hint });
  const err = (...a) => report('error', ...a);
  const major = (...a) => report('major', ...a);
  const warn = (...a) => report('warn', ...a);
  const note = (...a) => report('note', ...a);

  // ConfigurationUtils のヘルパ経由で読まれるキーは gen_action_reference.mjs の正規表現に映らない。
  // ソースで確認したものだけをここに置く。
  //   ConfigurationUtils.getRequirements():684,691 が "requirements" と "requirement" を読む
  const EXTRA_PARAMS = {
    CheckRequirements: ['requirement', 'requirements'],
    While: ['requirement', 'requirements'],
  };

  /** Action のパラメータとして有効か（継承チェーンの親と、共通のスペルパラメータも許す） */
  function actionParamValid(actionName, key) {
    const own = ACTIONS.actions[actionName];
    if (!own) return true; // 未知 Action は別途警告にしている
    if (own.includes(key)) return true;
    if ((EXTRA_PARAMS[actionName] ?? []).includes(key)) return true;
    // 親クラス。builtin/ 内の中間クラス(VolumeAction 等)も含むので params_by_class を引く
    for (const parent of ACTIONS.inherits[actionName] ?? []) {
      if ((ACTIONS.params_by_class[parent] ?? []).includes(key)) return true;
    }
    // `class` と `actions` は構造キー。スペル共通パラメータも Action から読めるものがある
    if (key === 'class' || key === 'actions') return true;
    return SPELL.parameter_keys.includes(key);
  }

  /** effects: の1エントリを検証する */
  function checkEffectEntry(file, path, entry) {
    if (!entry || typeof entry !== 'object') return;

    // EffectPlayer.java:259 — delayTicks = getInt("delay") * 20 / 1000（整数除算・クランプ無し）。
    // 50 未満は 0 tick になり、EffectPlayer.java:716 の delayTicks > 0 を通らず遅延なしで再生される。
    // 同じ "delay" でも Delay アクションは 1tick に切り上がる（逆方向）ので取り違えやすい。
    if (typeof entry.delay === 'number' && entry.delay > 0 && entry.delay < 50) {
      major(file, `${path}.delay`, `effects の delay はミリ秒で整数除算される。${entry.delay} は 0tick（遅延なし）になる`,
        '50 未満は切り捨てで消える。1tick 遅らせたいなら 50 以上を書く');
    }

    // EffectPlayer.java:341-342 — particle_data と particle_speed は同じフィールドに書き込む。
    // 後から読む particle_speed が勝つ。
    if (Object.prototype.hasOwnProperty.call(entry, 'particle_data')
        && Object.prototype.hasOwnProperty.call(entry, 'particle_speed')) {
      major(file, `${path}.particle_data`, 'particle_speed と同じ値を指すので particle_data は無視される',
        'どちらも particleData に代入され、後に読まれる particle_speed が勝つ。片方だけ書く');
    }
    for (const [k, v] of Object.entries(entry)) {
      if (k === 'effectlib') {
        const cls = v?.class;
        if (!cls) {
          err(file, `${path}.effectlib`, 'class: が無い', 'EffectLib のクラス一覧から選ぶ');
        } else if (!EFFECTLIB.classes[cls]) {
          err(file, `${path}.effectlib.class`, `不明な EffectLib クラス: ${cls}`, 'EffectLib のクラス一覧を参照');
        } else {
          const valid = new Set([...EFFECTLIB.classes[cls], ...EFFECTLIB.base, 'class', 'effect', 'parameters']);
          for (const ek of Object.keys(v)) {
            if (!valid.has(ek)) {
              err(file, `${path}.effectlib.${ek}`, `${cls} に無いパラメータ: ${ek}`,
                'EffectLib のソースで綴りを確認（無効なキーは無言で無視される）');
            }
          }
          if (v.particle && !PARTICLES.has(String(v.particle).toUpperCase())) {
            err(file, `${path}.effectlib.particle`, `1.21.8 に存在しない Particle: ${v.particle}`,
              'Paper の Particle enum で確認（redstone→dust など 1.20.5 で大量改名）');
          }
        }
        continue;
      }
      if (k === 'class') {
        if (!EFFECTS.player_classes.includes(v)) {
          err(file, `${path}.class`, `不明な EffectPlayer クラス: ${v}`,
            `使えるのは ${EFFECTS.player_classes.join(' / ')}`);
        }
        continue;
      }
      if (!EFFECTS.entry_keys.includes(k)) {
        note(file, `${path}.${k}`, `effects エントリのキーとして抽出できていない: ${k}`,
          'MagicPlugin の EffectPlayer のソースで確認（機械抽出漏れの可能性もあるのでソース確認推奨）');
      }
      if (k === 'particle' && !PARTICLES.has(String(v).toUpperCase())) {
        err(file, `${path}.particle`, `1.21.8 に存在しない Particle: ${v}`,
          'Paper の Particle enum で確認（redstone→dust / fireworks_spark→firework / block_crack→block）');
      }
      if ((k === 'sound' || k === 'custom_sound') && typeof v === 'string') {
        checkSound(file, `${path}.${k}`, v);
      }
    }
  }

  function checkSound(file, path, value) {
    // `sound_name` / `sound_name,volume,pitch` / `namespace.path`（カスタム音）を受ける
    const name = String(value).split(',')[0].trim();
    if (SOUNDS.has(name.toUpperCase())) return;
    // `namespace.path` 形式はリソースパックの sounds.json 依存で、ここからは検証できない。
    // 判定材料が無いので黙って通す（リソースパック側で確認すること）。
    if (name.includes('.')) return;
    err(file, path, `1.21.8 に存在しない Sound: ${name}`, 'Paper の Sound enum で確認');
  }

  // actions: 以外にもサブアクションリストを持つ Action がある（addHandler(spell, "...") で登録）。
  // ここに無いと中身が丸ごと未検証になるので、MagicPlugin 側が増えたら追随すること。
  //   CheckAction.java:40-41 / BaseProjectileAction.java:67-68 /
  //   CustomProjectileAction.java:163-165 / RecurseAction.java:91-92 / SpawnEntityAction.java:126
  const CHECK_ACTIONS = [
    'CheckBlock', 'CheckEntity', 'CheckHealth', 'CheckInventory', 'CheckLore', 'CheckMana',
    'CheckModifiers', 'CheckPotionEffects', 'CheckRequirements', 'CheckTrigger', 'CheckVelocity',
    'Probability', 'TakeCosts',
  ];
  const BASE_PROJECTILES = ['Firework', 'Projectile', 'ThrowBlock', 'ThrowItem', 'TNT'];
  const SUB_ACTION_KEYS = {
    fail: CHECK_ACTIONS,
    spawn: [...BASE_PROJECTILES, 'EntityProjectile', 'SpawnEntity'],
    tick: [...BASE_PROJECTILES, 'CustomProjectile', 'EntityProjectile'],
    headshot: ['CustomProjectile', 'EntityProjectile'],
    miss: ['CustomProjectile', 'EntityProjectile'],
    maxdepth: ['Recurse'],
  };

  /** actions: のリストを再帰的に検証する */
  function checkActionList(file, path, list) {
    if (!Array.isArray(list)) {
      err(file, path, 'actions は配列でなければならない');
      return;
    }
    list.forEach((step, i) => {
      const p = `${path}[${i}]`;
      if (!step || typeof step !== 'object') {
        err(file, p, 'Action は class: を持つマップでなければならない');
        return;
      }
      const cls = step.class;
      if (!cls) {
        err(file, p, 'class: が無い', 'MagicPlugin の Action 一覧から選ぶ');
      } else if (!ACTIONS.actions[cls]) {
        // 他プラグインが registerActionClass() で登録した Action もありうるので警告止まり
        warn(file, `${p}.class`, `MagicPlugin 本体に無い Action: ${cls}`,
          'まずタイポを疑う（MagicPlugin の Action 一覧）。外部プラグイン提供なら提供元を確認する');
      } else if (ACTIONS.abstract.includes(cls)) {
        err(file, `${p}.class`, `abstract なので直接使えない: ${cls}`);
      }
      for (const [k, v] of Object.entries(step)) {
        if (k === 'actions') {
          checkActionList(file, `${p}.actions`, v);
          continue;
        }
        // fail / tick / spawn / headshot / miss / maxdepth も中身は Action のリスト。
        // 対応していない Action に書くと登録されず、そのブロックは丸ごと実行されない。
        if (SUB_ACTION_KEYS[k] && Array.isArray(v)) {
          if (cls && !SUB_ACTION_KEYS[k].includes(cls)) {
            major(file, `${p}.${k}`, `${cls} は ${k}: を受け付けないので、この中の Action は実行されない`,
              `${k}: が使えるのは ${SUB_ACTION_KEYS[k].join(' / ')}`);
          }
          checkActionList(file, `${p}.${k}`, v);
          continue;
        }
        if (cls && ACTIONS.actions[cls] && !actionParamValid(cls, k)) {
          note(file, `${p}.${k}`, `${cls} のパラメータとして抽出できていない: ${k}`,
            'MagicPlugin の該当 Action のソースで確認（タイポは無言で無視されるので要注意）');
        }
        // AreaOfEffectAction:55 / LineOfEffectAction:55 はどちらも radius を getDouble で読んだ後
        // radius = (int)(multiplier * radius) で切り捨てる。0.75 や 0.5 は 0 になり、
        // 判定が「マスの中心点」だけになって当たらなくなる。
        if (RADIUS_TRUNCATED.includes(cls) && k === 'radius' && typeof v === 'number' && !Number.isInteger(v)) {
          major(file, `${p}.radius`, `${cls} の radius は int に切り捨てられる: ${v} → ${Math.trunc(v)}`,
            `${Math.trunc(v)} 相当になる。整数で書く`);
        }
        // DamageAction はダメージ前に setNoDamageTicks する。バニラの「無敵中」判定は
        // invulnerableTime > 10 なので、1〜10 は 0 と同じ（毎回フルダメージ＝多段ヒット）。
        if (cls === 'Damage' && k === 'no_damage_ticks' && typeof v === 'number' && v > 0 && v <= 10) {
          major(file, `${p}.no_damage_ticks`, `${v} は 0 と同じ（毎回フルダメージ）で多段ヒットを防げない`,
            '多段ヒットを防ぐなら指定しない。連撃させたいなら 0 と書く');
        }
        if (k === 'sound' && typeof v === 'string') checkSound(file, `${p}.sound`, v);
        if (k === 'particle' && typeof v === 'string' && !PARTICLES.has(v.toUpperCase())) {
          err(file, `${p}.particle`, `1.21.8 に存在しない Particle: ${v}`, 'Paper の Particle enum で確認');
        }
        if ((k === 'brush' || k === 'material') && typeof v === 'string'
            && !MATERIALS.has(v.toUpperCase()) && !v.includes(':') && v !== 'air') {
          warn(file, `${p}.${k}`, `1.21.8 の Material に無い: ${v}`, 'Paper の Material enum で確認');
        }
      }
      checkActionSemantics(file, p, cls, step);
    });
  }

  // radius を getDouble で読んでから (int) で切り捨てる Action（ソース確認済み）
  const RADIUS_TRUNCATED = ['AreaOfEffect', 'LineOfEffect'];

  /**
   * 単一キーでは判定できない「黙って実害が出る」組み合わせ。
   * ここに足すものは必ず MagicPlugin のソースで裏を取ること（推測で足さない）。
   */
  function checkActionSemantics(file, p, cls, step) {
    const has = (k) => Object.prototype.hasOwnProperty.call(step, k);

    // VelocityAction:91-104 — min_speed / max_speed のどちらかが 0 より大きいと
    // magnitude が高度ベースの式で丸ごと上書きされ、speed / living_entity_speed は捨てられる。
    if (cls === 'Velocity' && (Number(step.min_speed) > 0 || Number(step.max_speed) > 0)) {
      for (const k of ['speed', 'living_entity_speed', 'item_speed']) {
        if (has(k)) {
          major(file, `${p}.${k}`, `min_speed / max_speed があるので ${k} は無視される`,
            'Velocity は速度を高度から再計算して上書きする。どちらか一方の指定にする');
        }
      }
    }

    // CheckVelocityAction:23-24 — min 側の比較が max と同じ向き（speed > min_speed で不許可）。
    // 「最低速度」のつもりで書くと意味が反転する。
    if (cls === 'CheckVelocity' && has('min_speed')) {
      major(file, `${p}.min_speed`, 'min_speed の比較が max_speed と同じ向きで、意味が反転している',
        '実装は speed > min_speed → 不許可。「これ以上速いときだけ通す」は書けない。max_speed を使う');
    }

    // PotionEffectAction:103 — potion_effects があると add_effects は読まれない。
    if (cls === 'PotionEffect' && has('potion_effects') && has('add_effects')) {
      major(file, `${p}.add_effects`, 'potion_effects があるので add_effects は無視される',
        'PotionEffectAction はどちらか片方しか読まない。1つにまとめる');
    }

    // PotionEffectAction:110-113 — add_effects をマップで書くと値が強さになり、amplifier は読まれない。
    const effectsMap = step.potion_effects ?? step.add_effects;
    if (cls === 'PotionEffect' && has('amplifier')
        && effectsMap && typeof effectsMap === 'object' && !Array.isArray(effectsMap)) {
      major(file, `${p}.amplifier`, 'add_effects をマップで書いているので amplifier は無視される',
        'マップの値が強さになる（slow: 4 で鈍足V）。amplifier を使うなら add_effects は文字列かリストで書く');
    }

    // BaseSpell.getPotionEffects:811-820 — effect_<type> はカンマが無いと値が「強さ」。
    // tick 数のつもりで大きい数を書くと amplifier が跳ね上がる。
    for (const [k, v] of Object.entries(step)) {
      if (cls === 'PotionEffect' && /^effect_[a-z_]+$/.test(k) && typeof v === 'number' && v >= 10) {
        major(file, `${p}.${k}`, `カンマが無い値は「強さ」なので amplifier ${v} になる（tick 数ではない）`,
          `効果時間は duration:（ミリ秒）で指定する。tick で書くなら "${v},強さ" とカンマ区切りにする`);
      }
    }

    // CustomProjectileAction:185-186 — speed を読んだ直後に
    //   speed = parameters.getDouble("velocity", speed * 20);
    // としているので、velocity があると speed は捨てられる。しかも単位が20倍違う。
    if (cls === 'CustomProjectile' && has('speed') && has('velocity')) {
      major(file, `${p}.speed`, 'velocity があるので speed は無視される（単位も20倍違う）',
        'velocity は speed を20倍した値にあたる。どちらか一方だけ書く');
    }

    // ConeOfEffectAction は target_count と range しか読まず、Targeting も radius を見ない。
    // 扇の広さは fov（Targeting.java:623。既定 0.3、値が大きいほど広い）。
    if (cls === 'ConeOfEffect' && has('radius')) {
      major(file, `${p}.radius`, 'ConeOfEffect は radius を読まない（書いても何も起きない）',
        '扇の広さは fov（既定 0.3、大きいほど広い）。距離は range（既定 16）');
    }

    // ModifyNoDamageTicksAction:34 — setNoDamageTicks(Math.min(値, getMaximumNoDamageTicks()))。
    // バニラの最大無敵時間は 20 なので、それを超える値は黙って 20 に丸められる。
    if (cls === 'ModifyNoDamageTicks' && typeof step.no_damage_ticks === 'number'
        && step.no_damage_ticks > 20) {
      major(file, `${p}.no_damage_ticks`,
        `エンティティの最大無敵時間（既定 20）に丸められるので ${step.no_damage_ticks} は 20 になる`,
        '20 を超える無敵時間はこの Action では作れない');
    }

    // DelayAction:38 — targetTime = currentTimeMillis() + delay。単位はミリ秒。
    // 1tick = 50ms なので 50 未満はすべて「次tick」に丸まる。
    if (cls === 'Delay' && typeof step.delay === 'number' && step.delay >= 0 && step.delay < 50
        && step.delay !== 1) {
      major(file, `${p}.delay`, `delay の単位はミリ秒。${step.delay} は 1tick(50ms) 待ちに丸まる`,
        'tick 数のつもりなら 50 倍する（20tick = 1000）。1tick でよいなら delay: 1 と書く');
    }
  }

  /**
   * icon: の書式をチェックする。
   * CustomModelData がリソースパックに登録済みかは**検証しない**（パックはこのリポジトリの外にあり、
   * 環境ごとに違うため）。番号はリソースパック側の items 定義で確認すること。
   */
  function checkIcon(file, path, icon) {
    if (typeof icon !== 'string') return;
    const m = icon.match(/^([a-z_0-9]+)(?:\{(.*)\})?(?::(\d+))?(?:\?.*)?$/);
    if (!m) {
      warn(file, path, `icon の書式を解釈できない: ${icon}`, 'icon の書式は Wand.java の createItem を参照');
      return;
    }
    const material = m[1].toUpperCase();
    if (!MATERIALS.has(material)) {
      err(file, path, `1.21.8 に存在しない Material: ${m[1]}`, 'Paper の Material enum で確認');
      return;
    }
    if (!m[2]) return;
    const tag = m[2].trim();
    if (/^\d+$/.test(tag)) return; // 数字だけの短縮形（= CustomModelData）
    const cm = tag.match(/(?:CustomModelData|custom_model_data)\s*:\s*([0-9.]+)/);
    if (cm) {
      // ここは Magic 本体の挙動なのでリソースパックと無関係に効く
      if (cm[1].includes('.')) {
        err(file, path, `CustomModelData は整数のみ: ${cm[1]}`, '小数はログ警告のうえ無視される');
      }
      return;
    }
    if (!/item_model|ItemModel|Potion/.test(tag)) {
      warn(file, path, `解釈できないタグ: {${tag}}`, 'icon の書式は Wand.java の createItem を参照');
    }
  }

  /** wand 定義1件 */
  function checkWand(file, name, def, knownSpells) {
    if (!def || typeof def !== 'object') {
      err(file, name, 'wand 定義がマップになっていない');
      return;
    }
    for (const [k, v] of Object.entries(def)) {
      if (WAND.hidden_keys.includes(k)) {
        warn(file, `${name}.${k}`, `内部管理用のキー: ${k}`, 'yml に手で書かない');
        continue;
      }
      if (!WAND.property_keys.includes(k)) {
        err(file, `${name}.${k}`, `wand の有効キーに無い: ${k}`,
          'Wand.java の PROPERTY_KEYS 参照（PROPERTY_KEYS に無いキーは無視される）');
        continue;
      }
      if (WAND.action_slots.includes(k)) {
        if (typeof v === 'string' && !WAND.wand_actions.includes(v.toLowerCase())) {
          err(file, `${name}.${k}`, `不明な WandAction: ${v}`,
            `使えるのは ${WAND.wand_actions.join(' / ')}`);
        }
      }
      if (k === 'icon' || k === 'icon_inactive') checkIcon(file, `${name}.${k}`, v);
    }

    // alternate_spellN <-> alt_castN の対応
    const assigned = new Set();
    for (const slot of WAND.action_slots) {
      const v = def[slot];
      if (typeof v !== 'string') continue;
      const m = v.toLowerCase().match(/^alt_cast(\d?)$/);
      if (m) assigned.add(m[1] === '' ? 1 : Number(m[1]));
    }
    const declared = new Set();
    for (const key of Object.keys(def)) {
      const m = key.match(/^alternate_spell(\d?)$/);
      if (m && def[key]) declared.add(m[1] === '' ? 1 : Number(m[1]));
    }
    for (const n of declared) {
      if (!assigned.has(n)) {
        major(file, `${name}.alternate_spell${n === 1 ? '' : n}`,
          `対応する alt_cast${n === 1 ? '' : n} がどのクリックにも割り当てられていない`,
          'このスペルは発動できない');
      }
    }
    for (const n of assigned) {
      if (!declared.has(n)) {
        err(file, name, `alt_cast${n === 1 ? '' : n} を割り当てているが alternate_spell${n === 1 ? '' : n} が無い`,
          '番号を対応させる');
      }
    }

    // 耐久のある武器アイテム（剣・斧など）を wand にすると、殴るたびに耐久が減って
    // 最後は wand ごと消える。技を持つ wand には indestructible: true が要る。
    // 見た目だけのアイテム（技なし。COOKBOOK「見た目だけのアイテム」）は対象外。
    const hasSpells = declared.size > 0 || (Array.isArray(def.spells) && def.spells.length > 0);
    if (hasSpells && !('indestructible' in def)) {
      major(file, name, 'indestructible が無い（使っているうちに耐久で壊れて wand ごと消える）',
        'indestructible: true を付ける。壊れる仕様が意図なら false と明記する');
    }

    // Wand.java:2511,736 — icon_inactive_delay はミリ秒で保持し、使うときに * 20 / 1000 で
    // tick に整数除算する。50 未満は 0 tick になって切り替えが即座に起きる。
    if (typeof def.icon_inactive_delay === 'number'
        && def.icon_inactive_delay > 0 && def.icon_inactive_delay < 50) {
      major(file, `${name}.icon_inactive_delay`,
        `単位はミリ秒で整数除算される。${def.icon_inactive_delay} は 0tick になり遅延しない`,
        '50 未満は切り捨てで消える。1tick 遅らせたいなら 50 以上を書く');
    }

    // 参照している spell がプロジェクト内にあるか
    for (const key of Object.keys(def)) {
      if (!/^alternate_spell\d?$/.test(key)) continue;
      const spellName = def[key];
      if (typeof spellName === 'string' && spellName && !knownSpells.has(spellName)) {
        note(file, `${name}.${key}`, `spell "${spellName}" がこのプロジェクト内に見つからない`,
          'Magic 本体や他ファイルの既存スペルなら問題なし');
      }
    }
  }

  /** spell 定義1件 */
  function checkSpell(file, name, def) {
    if (!def || typeof def !== 'object') {
      err(file, name, 'spell 定義がマップになっていない');
      return;
    }
    for (const k of Object.keys(def)) {
      if (!SPELL.top_keys.includes(k)) {
        note(file, `${name}.${k}`, `spell のトップレベルキーとして想定外: ${k}`,
          'MagicPlugin の BaseSpell のソースで確認');
      }
    }
    if (def.actions) {
      for (const [section, list] of Object.entries(def.actions)) {
        if (!SPELL.spell_results.includes(section)) {
          note(file, `${name}.actions.${section}`, `SpellResult 名ではないセクション: ${section}`,
            '通常は cast を使う。MagicPlugin の SpellResult enum 参照');
        }
        checkActionList(file, `${name}.actions.${section}`, list);
      }
    }
    if (def.effects) {
      for (const [section, list] of Object.entries(def.effects)) {
        if (!Array.isArray(list)) {
          err(file, `${name}.effects.${section}`, 'effects セクションは配列でなければならない');
          continue;
        }
        // セクション名は任意（PlayEffects から呼ぶ）ので名前は検証しない
        list.forEach((e, i) => checkEffectEntry(file, `${name}.effects.${section}[${i}]`, e));
      }
    }
    if (def.parameters?.target) {
      const t = String(def.parameters.target).toLowerCase();
      if (!SPELL.target_types.includes(t)) {
        err(file, `${name}.parameters.target`, `不明な TargetType: ${def.parameters.target}`,
          `使えるのは ${SPELL.target_types.join(' / ')}`);
      }
    }
    if (def.parameters) {
      // spell の parameters: は各 Action にそのまま渡されるので、
      // Action 側のパラメータ（例: Sphere の thickness）を書くのも正当
      for (const k of Object.keys(def.parameters)) {
        if (SPELL.parameter_keys.includes(k)) continue;
        if (ANY_ACTION_PARAM.has(k)) continue;
        note(file, `${name}.parameters.${k}`, `spell パラメータとして抽出できていない: ${k}`,
          'MagicPlugin のソースで確認');
      }
    }
  }

  // ------------------------------------------------------------------ 実行
  // 全ファイルを先にパースして、spell 名の一覧を作る（wand の参照チェック用）
  const parsed = [];
  for (const f of files) {
    try {
      parsed.push({ file: f.name, doc: parseYaml(f.text) });
    } catch (ex) {
      err(f.name, '(YAML)', `パースできない: ${String(ex.message ?? ex).split('\n')[0]}`);
      parsed.push({ file: f.name, doc: null });
    }
  }

  /** spell ファイルか wand ファイルかを中身から判定する */
  const isSpellDef = (def) => !!(def && typeof def === 'object'
    && (def.actions || def.effects || def.parameters || def.costs));

  const knownSpells = new Set();
  for (const { doc } of parsed) {
    if (!doc || typeof doc !== 'object') continue;
    for (const [name, def] of Object.entries(doc)) {
      if (isSpellDef(def)) knownSpells.add(name);
    }
  }

  for (const { file, doc } of parsed) {
    if (doc === null || doc === undefined) continue;
    if (typeof doc !== 'object' || Array.isArray(doc)) {
      err(file, '(root)', 'トップレベルは「内部名: 定義」のマップでなければならない');
      continue;
    }
    for (const [name, def] of Object.entries(doc)) {
      if (!/^[a-z0-9_]+$/.test(name)) {
        err(file, name, '内部名は英数小文字とアンダースコアのみにする',
          'ハイフン・大文字・全角はトラブルの元');
      }
      if (isSpellDef(def)) checkSpell(file, name, def);
      else checkWand(file, name, def, knownSpells);
    }
  }

  return problems;
}

/** 深刻度ごとに件数を数える */
export function countByLevel(problems) {
  return LEVELS.map((lv) => problems.filter((p) => p.level === lv).length);
}
