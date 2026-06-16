// album.js
// 複数の JPEG 写真から約10秒のムービーアルバム mp4 を生成するモジュール。
// スライドショー + xfade クロスフェード + drawtext による字幕焼き込み（textfile 方式）。
// ESM モジュール。ffmpeg は PATH 上の /opt/homebrew/bin/ffmpeg を使用。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { config } from './config.js';

const execFileAsync = promisify(execFile);

// drawtext フィルタを含む ffmpeg-full を優先する。
// PATH 上の ffmpeg が drawtext 非対応（freetype 無効ビルド）の場合があるため。
const FFMPEG_CANDIDATES = [
  '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', // brew install ffmpeg-full（drawtext 対応）
  '/opt/homebrew/bin/ffmpeg',                  // brew install ffmpeg（drawtext 非対応の場合あり）
  'ffmpeg',                                    // PATH 上の ffmpeg（最終フォールバック）
];

/**
 * 使用する ffmpeg のパスを返す。
 * 先頭から順に existsSync で存在確認し、最初に見つかったものを返す。
 * @returns {string}
 */
function resolveFfmpegPath() {
  for (const p of FFMPEG_CANDIDATES) {
    if (!p.includes('/') || existsSync(p)) {
      console.log(`[album] 使用 ffmpeg: ${p}`);
      return p;
    }
  }
  return 'ffmpeg'; // ここには到達しないはずだが念のため
}

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────

/**
 * 使用するフォントパスを決定する。
 * config.album.fontPath → fontPathFallbacks の順に existsSync で確認し、
 * 最初に見つかったものを返す。どれも存在しない場合は null を返す。
 * @returns {string|null} フォントの絶対パス、見つからなければ null
 */
function resolveFontPath() {
  const candidates = [
    config.album.fontPath,
    ...config.album.fontPathFallbacks,
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      console.log(`[album] 使用フォント: ${p}`);
      return p;
    }
  }
  console.warn('[album] 指定フォントが見つかりません。fontfile 指定なしで続行します。');
  return null;
}

/**
 * 1枚あたりの表示秒数を動的に計算する。
 * クロスフェード重複を考慮した上で targetTotalSec に収め、[1.2, 3.0] にクランプ。
 * @param {number} count 写真枚数
 * @returns {number}
 */
function calcPerPhotoSec(count) {
  const { targetTotalSec, crossfadeSec } = config.album;
  // 全体尺 = count * perPhoto - (count-1) * crossfade を targetTotalSec に合わせる
  // → perPhoto = (targetTotalSec + (count-1) * crossfade) / count
  const perPhoto = (targetTotalSec + (count - 1) * crossfadeSec) / count;
  return Math.max(1.2, Math.min(3.0, perPhoto));
}

/**
 * テキストを一時ファイルへ書き出し、パスを返す。
 * ffmpeg の drawtext で textfile= オプションを使うことでエスケープ問題を回避する。
 * @param {string} text テキスト内容
 * @param {string} dir  書き出し先ディレクトリ
 * @param {string} name ファイル名
 * @returns {Promise<string>} 一時ファイルの絶対パス
 */
async function writeTempText(text, dir, name) {
  const p = join(dir, name);
  await fs.writeFile(p, text, 'utf8');
  return p;
}

// ─────────────────────────────────────────────
// メイン: buildAlbum
// ─────────────────────────────────────────────

/**
 * 複数の JPEG 写真から mp4 アルバムを生成する。
 *
 * @param {Object}   opts
 * @param {string[]} opts.photoPaths  JPEG の絶対パス配列（表示順）。1枚以上。
 * @param {string}   opts.title       アルバムタイトル（日本語）
 * @param {string[]} opts.captions    各写真の字幕配列（photoPaths と同じ長さ想定）
 * @param {string}   opts.outputPath  出力 mp4 の絶対パス
 * @returns {Promise<string>}  outputPath（成功時）。失敗時は例外を throw する。
 */
export async function buildAlbum({ photoPaths, title, captions, outputPath }) {
  const { crossfadeSec } = config.album;
  const count = photoPaths.length;

  // キャプション配列の長さを photoPaths に合わせる（不足はブランク、超過は切り捨て）
  const safeCaptions = Array.from({ length: count }, (_, i) => captions[i] ?? '');

  // 1枚あたりの表示秒数を決定
  const perPhotoSec = calcPerPhotoSec(count);
  console.log(`[album] 写真${count}枚 / 1枚${perPhotoSec.toFixed(2)}秒 / クロスフェード${crossfadeSec}秒`);

  // フォントパスを解決
  const fontPath = resolveFontPath();

  // 出力ファイルと同じディレクトリを一時作業場とする
  const workDir = dirname(outputPath);
  await fs.mkdir(workDir, { recursive: true });

  // 一時テキストファイルのパスを管理（finally ブロックで削除）
  const tempFiles = [];

  try {
    // ── ffmpeg 引数を構築 ──

    const args = [];

    // 各写真を静止画ループとして読み込む（-loop 1 で無限ループ、-t で切り取り）
    // xfade はクロスフェード区間で2ストリームを同時に必要とするため、
    // 入力の duration は perPhotoSec（クロスフェード分の重複込み）でよい
    for (const p of photoPaths) {
      args.push('-loop', '1', '-t', String(perPhotoSec), '-i', p);
    }

    // filter_complex を組み立てる（scale / drawtext / xfade を全て含む）
    const filterComplex = await buildFilterComplex({
      count,
      perPhotoSec,
      crossfadeSec,
      fontPath,
      safeCaptions,
      title,
      workDir,
      tempFiles,
    });

    // 出力オプション
    // -preset で x264 のエンコード速度を上げる（非力なサーバでの生成時間を短縮）。
    // -threads 0 で利用可能なCPUを全て使う。
    args.push(
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-c:v', 'libx264',
      '-preset', config.album.preset || 'veryfast',
      '-threads', '0',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',           // 既存ファイルを上書き許可
      outputPath,
    );

    const ffmpegPath = resolveFfmpegPath();
    console.log('[album] ffmpeg 実行開始...');
    await execFileAsync(ffmpegPath, args, {
      maxBuffer: 50 * 1024 * 1024, // 50MB（長い filter_complex の stderr 対策）
    }).catch(err => {
      // execFile は終了コード非ゼロで reject する。stderr ごとリスロー。
      throw new Error(`ffmpeg 失敗:\n${err.stderr || err.message}`);
    });

    console.log('[album] mp4 生成完了:', outputPath);
    return outputPath;

  } finally {
    // 一時テキストファイルを削除（エラー時も確実に実行）
    for (const f of tempFiles) {
      await fs.unlink(f).catch(() => {}); // 削除失敗は無視
    }
  }
}

// ─────────────────────────────────────────────
// filter_complex 構築ヘルパー
// ─────────────────────────────────────────────

/**
 * ffmpeg の -filter_complex 引数文字列を組み立てる。
 *
 * 各写真に scale/pad/fps/setsar/drawtext を適用してラベル [v0], [v1], ... を付け、
 * xfade で順次クロスフェード接続して最終出力 [vout] を作る。
 * 1枚だけの場合は xfade をスキップして直接 format=yuv420p で [vout] にする。
 *
 * @param {Object}   opts
 * @param {number}   opts.count         写真枚数
 * @param {number}   opts.perPhotoSec   1枚あたりの表示秒数
 * @param {number}   opts.crossfadeSec  クロスフェード秒数
 * @param {string|null} opts.fontPath   フォントパス（null なら fontfile 指定なし）
 * @param {string[]} opts.safeCaptions  各写真のキャプション（count と同じ長さ）
 * @param {string}   opts.title         アルバムタイトル
 * @param {string}   opts.workDir       一時ファイル書き出し先ディレクトリ
 * @param {string[]} opts.tempFiles     作成した一時ファイルを追記するリスト（呼び出し元が管理）
 * @returns {Promise<string>} filter_complex 文字列
 */
async function buildFilterComplex({
  count,
  perPhotoSec,
  crossfadeSec,
  fontPath,
  safeCaptions,
  title,
  workDir,
  tempFiles,
}) {
  const { width, height, fps } = config.album;
  const parts = [];

  // タイトル用テキストファイルを作成（先頭写真の drawtext で使用）
  const titleFile = await writeTempText(title, workDir, '_title.txt');
  tempFiles.push(titleFile);

  // ── ステップ1: 各入力に前処理 + drawtext を適用 ──
  for (let i = 0; i < count; i++) {
    // キャプション用テキストファイルを作成
    const captionFile = await writeTempText(safeCaptions[i], workDir, `_caption_${i}.txt`);
    tempFiles.push(captionFile);

    // scale+pad でアスペクト比を維持しながら WxH に収め、余白を黒で埋める
    // fps を統一し、SAR を 1:1 にする
    const baseFilter = [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      `fps=${fps}`,
      `setsar=1`,
    ].join(',');

    // キャプション: 下部中央に常時表示
    const captionDt = buildDrawtext({
      fontPath,
      textFile: captionFile,
      fontSize: 36,
      x: '(w-text_w)/2',
      y: 'h-80',
    });

    // タイトル: 先頭写真のみ、冒頭 0〜2 秒間、上部中央に表示
    let titleDt = '';
    if (i === 0) {
      titleDt = ',' + buildDrawtext({
        fontPath,
        textFile: titleFile,
        fontSize: 56,
        x: '(w-text_w)/2',
        y: '80',
        enable: 'between(t,0,2)',
      });
    }

    parts.push(`[${i}:v]${baseFilter},${captionDt}${titleDt}[v${i}]`);
  }

  // ── ステップ2: xfade チェーン（複数枚）または passthrough（1枚）──
  if (count === 1) {
    // 1枚: xfade 不要。format=yuv420p で [vout] を出力
    parts.push('[v0]format=yuv420p[vout]');
  } else {
    // 複数枚: [v0][v1] → xfade → [xf1], [xf1][v2] → xfade → [xf2], ...
    //
    // xfade offset の計算:
    //   i 番目の xfade が始まるタイムライン上の位置（秒）
    //   = 先行する i 枚の正味表示時間の合計
    //   = i * perPhotoSec - (i-1) * crossfadeSec - crossfadeSec
    //   = i * (perPhotoSec - crossfadeSec)
    //
    // 例: perPhoto=2.5秒, crossfade=0.5秒, 3枚の場合
    //   xfade1 offset = 1 * 2.0 = 2.0秒（[v0] 開始から2秒で [v1] へフェード開始）
    //   xfade2 offset = 2 * 2.0 = 4.0秒（[v0] 開始から4秒で [v2] へフェード開始）
    //   合計尺: 3 * 2.5 - 2 * 0.5 = 6.5秒

    let prevLabel = 'v0';
    for (let i = 1; i < count; i++) {
      const isLast = i === count - 1;
      // 最後の xfade 出力は 'vfinal' にし、次の format フィルタに渡す
      const outLabel = isLast ? 'vfinal' : `xf${i}`;
      const offset = i * (perPhotoSec - crossfadeSec);
      parts.push(
        `[${prevLabel}][v${i}]xfade=transition=fade:duration=${crossfadeSec}:offset=${offset.toFixed(4)}[${outLabel}]`,
      );
      prevLabel = outLabel;
    }

    // yuv420p フォーマット変換で [vout] を確定
    parts.push('[vfinal]format=yuv420p[vout]');
  }

  // セミコロンで連結して filter_complex 文字列を返す
  return parts.join(';');
}

// ─────────────────────────────────────────────
// drawtext フィルタ文字列ビルダー
// ─────────────────────────────────────────────

/**
 * drawtext フィルタ文字列を組み立てるヘルパー。
 * テキストは textfile= で渡すことでエスケープ問題を回避する。
 *
 * @param {Object}      opts
 * @param {string|null} opts.fontPath  フォントファイルパス（null なら fontfile 指定なし）
 * @param {string}      opts.textFile  テキストが書かれた一時ファイルの絶対パス
 * @param {number}      opts.fontSize  フォントサイズ（px）
 * @param {string}      opts.x         x 座標式（例: '(w-text_w)/2'）
 * @param {string}      opts.y         y 座標式（例: 'h-80'）
 * @param {string}      [opts.enable]  enable 式（例: 'between(t,0,2)'）
 * @returns {string} drawtext フィルタ文字列（"drawtext=..." 形式）
 */
function buildDrawtext({ fontPath, textFile, fontSize, x, y, enable }) {
  // ffmpeg フィルタグラフ上でパス内の特殊文字をエスケープ
  // シングルクォート → \' 、コロン → \:
  const escPath = (p) =>
    p.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');

  const params = [];
  if (fontPath) {
    params.push(`fontfile='${escPath(fontPath)}'`);
  }
  params.push(`textfile='${escPath(textFile)}'`);
  params.push(`fontsize=${fontSize}`);
  params.push(`fontcolor=white`);
  params.push(`bordercolor=black`);
  params.push(`borderw=2`);
  params.push(`x=${x}`);
  params.push(`y=${y}`);
  if (enable) {
    params.push(`enable='${enable}'`);
  }

  return `drawtext=${params.join(':')}`;
}
