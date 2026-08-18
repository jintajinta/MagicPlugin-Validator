# MagicPlugin Validator

[**→ ブラウザで使う**](https://jintajinta.github.io/MagicPlugin-Validator/)

[MagicPlugin](https://github.com/elBukkit/MagicPlugin) の wand / spell YAML を検証します。

対象: Minecraft 1.21.8 / Paper。

## CLI として使う

Node 18 以上。依存パッケージはありません。

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
拾いきれなかったキーは `· 未確認` に出ます。挙動に確信が要る場合はソースを直接読んでください。

## ライセンス

MIT License.
