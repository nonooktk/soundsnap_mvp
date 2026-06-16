/**
 * ai.js
 * OpenAI API（GPT・テキスト）を使って、ムービーアルバムの「タイトル」と
 * 「各写真のキャプション」を生成するモジュール。
 *
 * 公開インターフェース:
 *   import { generateAlbumText } from './ai.js';
 *   const { title, captions } = await generateAlbumText(photos);
 *
 * photos: [{ triggerWord: string, tSec: number }, ...]
 * 戻り値: { title: string, captions: string[] }
 *   - captions.length === photos.length を保証する
 */

import OpenAI from 'openai';
import { config } from './config.js';

// OpenAI クライアントは遅延生成する。
// OpenAI SDK はキー未設定だとコンストラクタで例外を投げるため、
// モジュール読み込み時ではなく、キー確認後にだけ生成する。
let _openai = null;
function getClient() {
  if (!_openai) _openai = new OpenAI(); // API キーは process.env.OPENAI_API_KEY から自動解決
  return _openai;
}

/**
 * フォールバック値を生成する。
 * API キー未設定・SDK 例外・JSON パース失敗のいずれでも呼ばれる。
 *
 * @param {Array<{triggerWord: string, tSec: number}>} photos
 * @returns {{ title: string, captions: string[] }}
 */
function buildFallback(photos) {
  return {
    title: 'おもいでアルバム',
    captions: photos.map((p) => p.triggerWord || 'すてきな瞬間'),
  };
}

/**
 * アルバムのタイトルと各写真のキャプションを OpenAI API で生成する。
 *
 * @param {Array<{triggerWord: string, tSec: number}>} photos
 *   triggerWord: 撮影のきっかけになった合言葉（例: "かわいい"）
 *   tSec: 撮影開始からの経過秒
 * @returns {Promise<{ title: string, captions: string[] }>}
 *   title: 日本語の短いアルバムタイトル（15 文字程度まで）
 *   captions: 各写真に添える日本語の短い一言（10〜20 文字程度）
 *             必ず photos.length と同じ長さになる
 */
export async function generateAlbumText(photos) {
  // OPENAI_API_KEY が未設定の場合はフォールバック
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[ai.js] OPENAI_API_KEY が未設定のためフォールバック値を返します。');
    return buildFallback(photos);
  }

  // 写真が 0 枚の場合もフォールバック
  if (!photos || photos.length === 0) {
    return buildFallback([]);
  }

  // GPT に渡す写真情報を文字列化（トリガー語と経過秒の系列）
  const photoList = photos
    .map((p, i) => `  ${i + 1}. 合言葉「${p.triggerWord}」（${p.tSec.toFixed(1)}秒時点）`)
    .join('\n');

  const expectedCount = photos.length;

  const userPrompt = `以下は、ある家族の動画通話で子どもたちが言った「合言葉」と撮影タイミングの記録です。
これをもとに、ムービーアルバム用の「タイトル」と「各写真のキャプション」を作ってください。

【写真一覧（${expectedCount}枚）】
${photoList}

【出力ルール】
- title: 日本語の短いアルバムタイトル（15文字以内）
- captions: 各写真に添える短い日本語の一言（10〜20文字程度）
- captionsの要素数は必ず${expectedCount}個にすること（多くても少なくてもダメ）

【出力形式（JSONオブジェクトのみ）】
{"title":"タイトル","captions":["1枚目の文","2枚目の文",...]}`;

  try {
    const response = await getClient().chat.completions.create({
      model: config.ai.model,
      max_tokens: config.ai.maxTokens,
      // JSON オブジェクトでの出力を強制（プロンプト内に "JSON" の語が必要）
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'あなたは家族向けムービーアルバムの編集者です。指定されたJSON形式のみを出力し、説明文やコードブロック記号は一切付けないこと。',
        },
        { role: 'user', content: userPrompt },
      ],
    });

    // レスポンスからテキストを取り出す
    const rawText = response.choices?.[0]?.message?.content?.trim();
    if (!rawText) {
      console.warn('[ai.js] OpenAI のレスポンスが空です。フォールバックを返します。');
      return buildFallback(photos);
    }

    // JSON パース
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      // コードブロックで囲まれている場合などを除去して再試行
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.warn('[ai.js] JSON パース失敗。フォールバックを返します。', parseErr.message);
        return buildFallback(photos);
      }
    }

    // title / captions の存在チェック
    const title = typeof parsed.title === 'string' && parsed.title.length > 0
      ? parsed.title
      : 'おもいでアルバム';

    let captions = Array.isArray(parsed.captions) ? parsed.captions : [];

    // captions の長さを photos.length に合わせる（足りなければ triggerWord で補完、多ければ切り詰め）
    if (captions.length < expectedCount) {
      for (let i = captions.length; i < expectedCount; i++) {
        captions.push(photos[i].triggerWord || 'すてきな瞬間');
      }
    } else if (captions.length > expectedCount) {
      captions = captions.slice(0, expectedCount);
    }

    return { title, captions };
  } catch (err) {
    console.warn('[ai.js] OpenAI API 呼び出し中にエラーが発生しました。フォールバックを返します。', err.message);
    return buildFallback(photos);
  }
}
