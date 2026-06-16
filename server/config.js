// アプリ全体の設定。トリガー語・タイムアウト・保存先・ffmpeg/フォント等をここに集約する。
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const config = {
  // サーバ
  port: Number(process.env.PORT) || 3000,

  // ディレクトリ
  capturesDir: join(ROOT, 'captures'), // セッションごとの一時スナップショット
  albumsDir: join(ROOT, 'albums'),     // 保存確定した最終動画＝「特定のディレクトリ」

  // 撮影セッション
  autoEndMs: 60 * 1000, // 終了ボタンが押されない場合の自動終了（1分）

  // トリガー語（初期セット。フロントの triggers.js と同期）
  triggerWords: ['かわいい', 'すごい', 'かっこいい', 'ありがとう', 'ばいばい', 'おはよう', 'こんにちは'],

  // 同一語の連続誤発火を防ぐクールダウン（ミリ秒）
  triggerCooldownMs: 1500,

  // アルバム動画生成
  album: {
    perPhotoSec: 2.0,    // 1枚あたりの表示秒数
    crossfadeSec: 0.5,   // 写真間クロスフェード秒数
    targetTotalSec: 10,  // 目標の合計尺（秒）。枚数に応じて perPhotoSec を自動調整
    // 解像度・fps はエンコード負荷に直結する。非力なサーバ(Azure B1=1vCPU)でも
    // 軽く生成できるよう 540p / 24fps に抑える（アルバム用途には十分）。
    width: 960,
    height: 540,
    fps: 24,
    // x264 エンコード速度プリセット。'veryfast' で品質を保ちつつ大幅高速化。
    // （'ultrafast'〜'medium' で速度↔品質のトレードオフ）
    preset: 'veryfast',
    // macOS 標準の日本語フォント。字幕焼き込みに使用。
    fontPath: '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc',
    // フォールバック候補（上が見つからない場合に順に試す）
    // macOS 用パスに加え、Linux コンテナ用の Noto CJK パスも含める。
    fontPathFallbacks: [
      '/System/Library/Fonts/Hiragino Sans GB.ttc',
      '/Library/Fonts/Arial Unicode.ttf',
      '/System/Library/Fonts/AppleSDGothicNeo.ttc',
      // Linux (Debian/Ubuntu, fonts-noto-cjk)
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
    ],
  },

  // OpenAI API（テキストAI: タイトル/キャプション生成）
  ai: {
    model: 'gpt-4o-mini',
    maxTokens: 1024,
  },
};
