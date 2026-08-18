# MagicPlugin Validator

[**→ ブラウザで使う**](https://jintajinta.github.io/MagicPlugin-Validator/)

[MagicPlugin](https://github.com/elBukkit/MagicPlugin) の wand / spell YAML を、配置前に検証します。

Magic は書き間違いを警告しません。未知のキーも無効な enum 名も黙って無視され、
`/magic load` は成功したのに「なぜか何も起きない」という形でしか表に出てきません。
このツールはそれを保存前に見つけます。

検証はすべてブラウザ内で完結します。**ファイルはどこにも送信されません。**

対象: Minecraft 1.21.8 / Paper。

---

## 何を見ているか

出力は深刻度4段階です。

| | 内容 | 対応 |
|---|---|---|
| `✗ エラー` | 存在しない Particle / Sound / Material、wand の無効キー、不明な EffectLib クラス、`alt_castN` の番号ずれ | 必ず潰す。その行は確実に効かない |
| `⚠ 重要` | **構文は正しいのに黙って実害が出る**もの | 必ず潰す。エラーが出ないぶんこちらの方が危険 |
| `! 警告` | タイポの疑い、推奨から外れている | 見て判断する |
| `· 補足` | 参照データの機械抽出が漏れているかもしれない行 | ソースを確認して有効なら無視してよい |

### 「⚠ 重要」の中身

エラーにならないまま挙動が変わるものだけを集めています。**すべて MagicPlugin のソースで裏を取ってあります。**

| 判定 | 根拠 |
|---|---|
| `AreaOfEffect` / `LineOfEffect` の小数 `radius` は `int` に切り捨てられる（`0.75` → `0` で当たらなくなる） | `AreaOfEffectAction:46,55` / `LineOfEffectAction:45,55` |
| `Velocity` に `min_speed` / `max_speed` があると `speed` は無視される | `VelocityAction:91-104` が高度ベースの式で上書きする |
| `CustomProjectile` に `velocity` があると `speed` は無視される（単位も20倍違う） | `CustomProjectileAction:185-186` |
| `CheckVelocity` の `min_speed` は意味が反転している | `CheckVelocityAction:24` が `speed > min_speed → 不許可` |
| `ConeOfEffect` は `radius` を読まない（扇の広さは `fov`） | `ConeOfEffectAction:37-38` と `Targeting:618-651` のどちらにも無い |
| `PotionEffect` で `potion_effects` があると `add_effects` は無視される | `PotionEffectAction:103` |
| `PotionEffect` で `add_effects` をマップで書くと `amplifier` は無視される | `PotionEffectAction:110-113` |
| `effect_<type>: N`（カンマ無し）の N は「強さ」で tick 数ではない | `BaseSpell.getPotionEffects:811-820` |
| `Damage` の `no_damage_ticks: 1〜10` は `0` と同じで多段ヒットを防げない | `DamageAction:133-136` ＋ バニラの `invulnerableTime > 10` |
| `ModifyNoDamageTicks` は `no_damage_ticks > 20` を 20 に丸める | `ModifyNoDamageTicksAction:34` |
| `Delay` の `delay` はミリ秒。50 未満は 1tick に丸まる | `DelayAction:38` |
| `effects:` の `delay` はミリ秒を整数除算するので 50 未満は **0tick**（遅延なし）になる | `EffectPlayer:259`。`Delay` とは丸め方向が逆 |
| `effects:` の `particle_data` と `particle_speed` は同じ値を指す（後者が勝つ） | `EffectPlayer:341-342` |
| wand の `icon_inactive_delay` も 50 未満は 0tick | `Wand:2511,736` |
| 技を持つ wand に `indestructible` が無いと耐久で壊れて wand ごと消える | `Wand.java` |
| `fail` / `tick` / `spawn` / `headshot` / `miss` / `maxdepth` を対応していない Action に書くと、そのブロックは実行されない | `addHandler(spell, "...")` の登録先 |

`fail:` などのサブアクションの**中身も再帰的に検証します**。ここは見落としやすく、
中に書いた Particle 名の間違いは実行時まで気付けません。

---

## CLI として使う

Node 18 以上。依存パッケージはありません（js-yaml は同梱）。

```bash
git clone https://github.com/jintajinta/MagicPlugin-Validator
cd MagicPlugin-Validator

node bin/validate.mjs path/to/wands/          # ディレクトリを再帰検証
node bin/validate.mjs my_sword_wand.yml       # ファイル指定
node bin/validate.mjs --level=2 path/to/      # エラーと重要だけ
```

終了コードは **エラー＋重要が 0 件なら 0、あれば 1**。CI に組み込めます。

```yaml
- run: node bin/validate.mjs wands/ --level=2
```

wand と spell の判別はファイル名ではなく中身で行います（`actions:` などを持てば spell）。
両方をまとめて渡すと、`alternate_spell` が指す spell が実在するかも確認します。

---

## 参照データの再生成

`src/reference.js` は自動生成物です。MagicPlugin が更新されたら作り直してください。

```bash
# 1. ソースを用意する
#    plugin/MagicPlugin/          ... https://github.com/elBukkit/MagicPlugin
#    plugin/effectlib-10.12-src/  ... EffectLib の展開済みソース

# 2. ソースから reference/*.enum.json を抽出する
node tools/gen_action_reference.mjs
node tools/gen_effectlib_reference.mjs
node tools/gen_config_reference.mjs

# 3. reference/ をまとめて src/reference.js にする
node tools/build_reference.mjs
```

`reference/particles.txt` / `sounds.txt` / `materials.txt` は Paper の enum ダンプです。
バージョンを上げるときは、対象バージョンの `Particle` / `Sound` / `Material` の値を
1行1件で入れ替えてから手順3を回してください。

抽出は正規表現ベースなので **網羅的ですが完全ではありません**。
拾いきれなかったキーは `· 補足` に出ます。挙動に確信が要る場合はソースを直接読んでください。

---

## 検証していないこと

- **CustomModelData がリソースパックに登録済みか。** パックは環境ごとに違うため対象外です
- **カスタム音（`namespace.path` 形式）の実在。** 同上。バニラの Sound 名は検証します
- **ゲームバランス。** 数値が壊れていないかは見ますが、強すぎるかどうかは見ません

---

## ライセンス

MIT License.

参照データは [MagicPlugin](https://github.com/elBukkit/MagicPlugin)（MIT）と
[EffectLib](https://github.com/Slikey/EffectLib) のソース、および Paper 1.21.8 の enum から生成しています。
同梱の [js-yaml](https://github.com/nodeca/js-yaml) は MIT License（`vendor/js-yaml.LICENSE`）。
