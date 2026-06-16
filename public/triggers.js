// トリガー語の定義とマッチ判定。
// 検出ロジックを STT 実装から分離し、最終形で「感情変化検知」等を足せる拡張点にする。

// 初期トリガー語（server/config.js と同期）
export const TRIGGER_WORDS = [
  'かわいい',
  'すごい',
  'かっこいい',
  'ありがとう',
  'ばいばい',
  'おはよう',
  'こんにちは',
];

// カタカナ → ひらがな変換（揺れ吸収）
function toHiragana(s) {
  return s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// 正規化: 前後空白除去・ひらがな化・伸ばし棒や記号の単純化
function normalize(s) {
  return toHiragana(String(s || ''))
    .toLowerCase()
    .replace(/\s+/g, '');
}

const NORMALIZED = TRIGGER_WORDS.map((w) => ({ raw: w, norm: normalize(w) }));

// 認識テキストから最初に見つかったトリガー語を返す（部分一致）。無ければ null。
export function matchTrigger(text) {
  const norm = normalize(text);
  if (!norm) return null;
  for (const { raw, norm: n } of NORMALIZED) {
    if (norm.includes(n)) return raw;
  }
  return null;
}

// トリガー語ごとのクールダウン管理。連続する同一発話の多重発火を防ぐ。
export class TriggerCooldown {
  constructor(cooldownMs = 1500) {
    this.cooldownMs = cooldownMs;
    this.lastFired = new Map(); // word -> timestamp(ms)
  }

  // 発火可能なら true を返し、内部の最終発火時刻を更新する。
  tryFire(word, now = Date.now()) {
    const last = this.lastFired.get(word) || 0;
    if (now - last < this.cooldownMs) return false;
    this.lastFired.set(word, now);
    return true;
  }

  reset() {
    this.lastFired.clear();
  }
}
