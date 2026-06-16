# SoundSnap MVP

ビデオ通話中の「合言葉」を音声認識して、その瞬間のカメラ映像を自動でスナップショットし、
撮影終了後に約10秒のムービーアルバムを自動生成する MVP です。

最終構想（高齢者とのビデオ通話中に外部カメラのシャッターを自動で切り、通話後にアルバム化する）の
**基本機能を切り出したもの**で、検出ロジック（`stt.js`/`triggers.js`）と撮影アクション（`capture.js`）を
モジュール分離し、将来 DSLR 駆動・別 STT・サーバ連携へ載せ替えられる構成にしています。

## できること

1. 「撮影開始」→ PC内蔵カメラのライブ映像＋音声認識スタート
2. 合言葉（下記）を話すと、その瞬間のフレームを**即スナップショット**（ローカル canvas 描画でラグ最小）
3. 「終了」押下、または **1分経過で自動終了**
4. 撮った写真から **約10秒のムービーアルバム mp4** を自動生成（クロスフェード＋字幕焼き込み）
5. プレビュー再生 →「保存」で `albums/` に保存 → ホームに戻る

### 反応する合言葉

`かわいい` / `すごい` / `かっこいい` / `ありがとう` / `ばいばい` / `おはよう` / `こんにちは`

（変更する場合は `server/config.js` と `public/triggers.js` の両方を編集してください）

## 動作要件

- **ブラウザは Chrome または Edge 必須**（音声認識に Web Speech API を使用。Safari/Firefox では動作しません）
- macOS（日本語フォント・ffmpeg パスを macOS 前提で設定）
- Node.js 18 以上

## セットアップ

```bash
# 1) ffmpeg（drawtext=字幕焼き込み対応版）をインストール
#    ※ 標準の `brew install ffmpeg` は freetype 無効で drawtext が使えないため ffmpeg-full が必要
brew install ffmpeg-full

# 2) プロジェクトディレクトリへ
cd /Users/mitsuru/Desktop/soundsnap_mvp

# 3) 依存をインストール
npm install

# 4) 環境変数ファイルを用意（テキストAIを使う場合のみキーを記入）
cp .env.example .env
#    .env を開いて OPENAI_API_KEY=... を設定（未設定でもフォールバックで動作します）
```

> **OPENAI_API_KEY について**
> アルバムのタイトル・キャプションを GPT（OpenAI）で生成するために使います。
> 既定モデルは `gpt-4o-mini`（`server/config.js` の `ai.model` で変更可）。
> 未設定でも動作し、その場合はタイトル「おもいでアルバム」＋合言葉そのものをキャプションに使うフォールバックになります。
> キー取得: https://platform.openai.com/api-keys

## 起動

```bash
cd /Users/mitsuru/Desktop/soundsnap_mvp
npm start
```

起動後、**Chrome で** http://localhost:3000 を開きます（`localhost` のため getUserMedia / 音声認識が許可されます）。
初回はカメラとマイクの使用許可を求められるので「許可」してください。

## 使い方

1. 「撮影開始」をクリック
2. カメラに向かって合言葉（例:「かわいい」「すごい」）を話す → サムネイルが即追加される
3. 「終了」をクリック（または1分放置で自動終了）
4. アルバムが生成され、プレビュー再生される
5. 「保存」で `albums/` に mp4 が保存される（「やり直す」で破棄してホームへ）

保存先を確認:

```bash
ls -la /Users/mitsuru/Desktop/soundsnap_mvp/albums/
```

## ディレクトリ構成

```
soundsnap_mvp/
  server/
    index.js     Express: 静的配信 + API（session/start, album/generate, album/save）
    config.js    トリガー語・タイムアウト・保存先・ffmpeg/フォント等の設定を集約
    album.js     ffmpeg でスライドショー mp4 生成（xfade クロスフェード＋字幕焼き込み）
    ai.js        OpenAI API でタイトル/キャプション生成（キー未設定/失敗時はフォールバック）
  public/
    index.html   4画面（ホーム/撮影/生成中/プレビュー）のSPA
    app.js       画面遷移・カメラ起動・自動終了タイマー・各APIとの連携
    stt.js       ★差し替え可能な STT（Web Speech API 実装）
    triggers.js  トリガー語の定義とマッチ判定・クールダウン
    capture.js   ★差し替え可能な撮影アクション（canvasスナップショット実装）
    styles.css   UI スタイル
  captures/      セッションごとの一時スナップショット・生成アルバム（gitignore）
  albums/        保存確定した最終動画＝「特定のディレクトリ」（gitignore）
```

★ = 最終形で別実装（DSLRシャッター駆動 / Vosk・Cloud STT）へ差し替える拡張点。

## 設計上のポイント

- **低遅延**: スナップショットは `<video>` → オフスクリーン `<canvas>` への `drawImage` で完結し、
  ネットワークを介さないため「合言葉 → 撮影」のラグはほぼ音声認識の遅延のみ。
  Web Speech API は `interimResults`（確定前の途中結果）でもトリガー判定して即発火します。
- **途切れない認識**: `continuous` ＋ `onend` での自動再起動で撮影中は認識を維持。
- **AIフォールバック**: OpenAI 呼び出しが失敗してもアルバム生成は必ず完了します。

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| 「Web Speech API に未対応」 | Chrome / Edge で開く |
| カメラ/マイクが映らない | ブラウザの権限を許可。`http://localhost:3000` で開いているか確認（IPアドレス直打ちはNG） |
| 字幕が出ない / 生成失敗 | `brew install ffmpeg-full` を実行（標準 ffmpeg は drawtext 非対応のことがある） |
| タイトル/字幕が合言葉のまま | `.env` の `OPENAI_API_KEY` が未設定（フォールバック動作。設定すればAI生成になる） |

## スコープ外（今回未実装・最終形で対応）

- 感情変化の検知（今回は合言葉トリガーのみ）
- 外部カメラ（DSLR）連携、ビデオ通話機能、高齢者向け専用デバイス、デバイス間連携
