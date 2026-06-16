// トリガー語の定義とマッチ判定。
// 検出ロジックを STT 実装から分離し、最終形で「感情変化検知」等を足せる拡張点にする。

// 初期トリガー語（画面表示・キャプションに使う正規表記）
export const TRIGGER_WORDS = [
  'かわいい',
  'すごい',
  'かっこいい',
  'ありがとう',
  'ばいばい',
  'おはよう',
  'こんにちは',
];

// 各トリガー語の表記ゆれ（特に音声認識が漢字変換した場合）を吸収するためのエイリアス。
// 音声認識は「かわいい」を「可愛い」のように漢字で返すことがあり、
// ひらがな化だけではマッチしないため、漢字形を明示的に登録する。
// カタカナは normalize() がひらがなへ変換するのでここには不要。
const TRIGGER_ALIASES = {
  'かわいい': ['可愛い'],
  'すごい': ['凄い'],
  'かっこいい': ['格好いい', '格好良い', 'かっこ良い'],
  'ありがとう': ['有難う', '有り難う'],
  'ばいばい': [],
  'おはよう': ['お早う'],
  'こんにちは': ['今日は', 'こんにちわ'],
};

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

// 正規表記＋エイリアスを展開した照合テーブル。
// 各エントリは { canonical: 正規表記, norm: 正規化済みの照合パターン }。
// どの表記でマッチしても canonical（ひらがなの正規表記）を返すので、
// キャプションや AI への入力は常に統一される。
const NORMALIZED = TRIGGER_WORDS.flatMap((w) =>
  [w, ...(TRIGGER_ALIASES[w] || [])].map((variant) => ({
    canonical: w,
    norm: normalize(variant),
  }))
);

// 認識テキストから最初に見つかったトリガー語を返す（部分一致）。無ければ null。
// 返り値は正規表記（ひらがな）。
export function matchTrigger(text) {
  const norm = normalize(text);
  if (!norm) return null;
  for (const { canonical, norm: n } of NORMALIZED) {
    if (n && norm.includes(n)) return canonical;
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
