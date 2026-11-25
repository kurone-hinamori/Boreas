# Boreas

Notos で書いた小説の表紙や挿絵を作る Tauri デスクトップアプリです。Euros で作ったキャラクターシートを読み込み、3D の下絵をもとに ComfyUI で清書します。

設計は [docs/design.md](docs/design.md) にあります。いまは設計の M2(2〜4人の挿絵)までできています。

## 使い方

1. **設定**:ComfyUI と Ollama の接続を確かめ、Ollama のモデルを選びます。Euros のライブラリの場所も確かめます。
2. **場面**の「新規作成」で場面を作り、「人物を足す」で Euros のキャラクターを置きます(最大4人)。人物ごとに色(赤・青・緑・橙)が付き、下絵ではこの色で描き分けます。素体(女性・男性 × 細身・標準・がっしり)と身長は、キャラクターの説明から決まります(直せます)。
3. **人物**:3D の表示で人物をクリックして選び、ドラッグで床の上を動かします。
   - ポーズを一覧から選び、黒い点(手足の先)をドラッグして腕や脚の向きを変えます。
   - 手の形(開く・握る・指差す・ピースなど)、視線(カメラ・ほかの人物・顔の向き)、動作と表情(日本語)を決めます。
4. **小物**:バット・剣・棒・球・箱を、実際の寸法(cm)で置きます。長い物は人物の手に持たせ、持つ位置と向きを決めます。
5. **触れる**:「鈴のバットの先 → カイの胸」「Aの右手 → Bの肩」のように、触れる点を決めます。手や小物の先がそこに寄り、黒い印とプロンプトで清書に伝えます。
6. **カメラ**:表紙・挿絵(縦・横)の枠を選び、「全身・膝上・胸上」かドラッグでカメラを決めます。
7. **清書**:背景を日本語で書き、「英語にする」でプロンプトの英語を作ります。「清書する」で、3D の下絵と人物のシートを ComfyUI(MiniMax-H3-Image)に渡して候補を作ります(1枚に6分ほど)。
8. 候補から1枚を「採用」し、「書き出す」で PNG に保存します。

## 必要なもの

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)(`http://127.0.0.1:8188` で起動)と、MiniMax-H3-Image のモデル
- [Ollama](https://ollama.com/)(`http://127.0.0.1:11434` で起動)と、日本語を扱えるモデル
- [Euros](https://github.com/kurone-hinamori/Euros) で作ったキャラクター

## 開発

```
npm install
npm run tauri dev
```

開発サーバーは、Euros・Notos(1420)と同時に動かせるよう 1430 番を使います。

確かめるとき:

```
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## 素体

人物の素体は MakeHuman(CC0)で作った `public/figures/*.glb` です。作り直すときは、Blender 5.2 と MPFB2 の拡張機能を入れて次を実行します。

```
blender -b --python tools/make_figure.py -- --all public/figures
```

ポーズは `src/lib/poses.ts` にあります。開発サーバー(`npm run dev`)で `http://localhost:1430/dev/poses.html` を開くと、すべてのポーズを並べて確かめられます。

## 保存先

- Boreas が書く場所:既定は `%APPDATA%\Boreas\library\`。設定で変えられます。
  - `scenes\<id>\scene.json`(場面)、`sketches\<id>.png`(下絵)、`results\<id>.png`(清書の候補)
  - 消した場面は `.trash\` に移します。
- 読むだけの場所:Euros のライブラリ(既定は `%APPDATA%\Euros\library\`)と Notos のデータ(既定は `%APPDATA%\io.github.kurone-hinamori.notos\`)。Boreas はこれらを書き換えません。

## リリース

- GitHub の Actions で **Bump version** を実行すると、バージョンを上げてタグを付け、インストーラーと自動アップデート用の `latest.json` を Releases に公開します。
- `v*` のタグを手で push しても同じようにリリースされます。
- 更新の署名鍵は `~/.tauri/boreas.key`(パスワードは `~/.tauri/boreas.key.password`)にあります。公開鍵は `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に入っています。
  - 秘密鍵とパスワードは、リポジトリの Secrets の `TAURI_SIGNING_PRIVATE_KEY` と `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` に登録します。
  - 鍵をなくすと、インストール済みのアプリに更新を届けられなくなります。バックアップしてください。
