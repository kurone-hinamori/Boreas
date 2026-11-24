# Boreas

Notos で書いた小説の表紙や挿絵を作る Tauri デスクトップアプリです。Euros で作ったキャラクターシートを読み込み、3D の下絵をもとに ComfyUI で清書します。

設計は [docs/design.md](docs/design.md) にあります。いまは土台だけで、画面は場面・場所・キャラクター(Euros から読むだけ)・設定です。

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

## 保存先

- Boreas が書く場所:既定は `%APPDATA%\Boreas\library\`(`places\<id>\` と `scenes\<id>\`)。設定で変えられます。
- 読むだけの場所:Euros のライブラリ(既定は `%APPDATA%\Euros\library\`)と Notos のデータ(既定は `%APPDATA%\io.github.kurone-hinamori.notos\`)。Boreas はこれらを書き換えません。

## リリース

- GitHub の Actions で **Bump version** を実行すると、バージョンを上げてタグを付け、インストーラーと自動アップデート用の `latest.json` を Releases に公開します。
- `v*` のタグを手で push しても同じようにリリースされます。
- 更新の署名鍵は `~/.tauri/boreas.key`(パスワードは `~/.tauri/boreas.key.password`)にあります。公開鍵は `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に入っています。
  - 秘密鍵とパスワードは、リポジトリの Secrets の `TAURI_SIGNING_PRIVATE_KEY` と `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` に登録します。
  - 鍵をなくすと、インストール済みのアプリに更新を届けられなくなります。バックアップしてください。
