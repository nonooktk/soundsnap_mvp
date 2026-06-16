// 画面遷移とセッション制御の中枢。
// カメラ起動 → STT でトリガー検出 → 即スナップショット → 終了 → アルバム生成 → プレビュー → 保存。
import { TRIGGER_WORDS, matchTrigger, TriggerCooldown } from './triggers.js';
import { WebSpeechSTT } from './stt.js';
import { CanvasCapture } from './capture.js';

const AUTO_END_MS = 60 * 1000;   // 終了ボタン未押下時の自動終了（1分）
const COOLDOWN_MS = 1500;        // 同一トリガー語の連続発火防止

// ---- DOM 参照 ----
const $ = (id) => document.getElementById(id);
const screens = {
  home: $('screen-home'),
  recording: $('screen-recording'),
  processing: $('screen-processing'),
  preview: $('screen-preview'),
};
const els = {
  triggerList: $('trigger-list'),
  homeNote: $('home-note'),
  btnStart: $('btn-start'),
  btnStop: $('btn-stop'),
  timer: $('timer'),
  preview: $('preview'),
  flash: $('flash'),
  heard: $('heard'),
  shotCount: $('shot-count'),
  thumbs: $('thumbs'),
  processingSub: $('processing-sub'),
  albumTitle: $('album-title'),
  albumVideo: $('album-video'),
  btnSave: $('btn-save'),
  btnDiscard: $('btn-discard'),
  previewNote: $('preview-note'),
  toast: $('toast'),
};

// ---- セッション状態 ----
const state = {
  sessionId: null,
  stream: null,
  stt: null,
  capture: null,
  cooldown: new TriggerCooldown(COOLDOWN_MS),
  shots: [],          // { blob, triggerWord, tSec }
  startedAt: 0,
  autoEndTimer: null,
  tickTimer: null,
  sessionActive: false, // 撮影セッション進行中フラグ（endSession の多重実行防止）
};

// ---- 画面切替 ----
function show(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('active', key === name);
  }
}

function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove('show'), ms);
}

// ---- 初期表示 ----
els.triggerList.textContent = TRIGGER_WORDS.join('・');

els.btnStart.addEventListener('click', startSession);
els.btnStop.addEventListener('click', () => endSession('manual'));
els.btnSave.addEventListener('click', saveAlbum);
els.btnDiscard.addEventListener('click', resetToHome);

// =====================================================================
// 撮影セッション開始
// =====================================================================
async function startSession() {
  els.homeNote.textContent = '';
  try {
    // STT は対応チェックを兼ねて先に生成（未対応なら例外）
    state.stt = new WebSpeechSTT({ lang: 'ja-JP' });
  } catch (err) {
    els.homeNote.textContent = err.message;
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
  } catch (err) {
    els.homeNote.textContent = 'カメラ/マイクの使用が許可されませんでした: ' + err.message;
    return;
  }

  // サーバにセッション開始を通知
  try {
    const r = await fetch('/api/session/start', { method: 'POST' });
    const j = await r.json();
    state.sessionId = j.sessionId;
  } catch (err) {
    els.homeNote.textContent = 'サーバに接続できませんでした: ' + err.message;
    stopStream();
    return;
  }

  // 状態初期化
  state.shots = [];
  state.cooldown.reset();
  state.startedAt = Date.now();
  state.sessionActive = true; // セッション開始

  els.preview.srcObject = state.stream;
  state.capture = new CanvasCapture(els.preview);
  els.shotCount.textContent = '0枚';
  els.heard.textContent = '（聞き取り中…）';
  els.thumbs.innerHTML = '';

  // STT 開始: interim を含めトリガー判定 → 即撮影
  state.stt.onResult((text, isFinal) => {
    els.heard.textContent = text || '（聞き取り中…）';
    const word = matchTrigger(text);
    if (word && state.cooldown.tryFire(word)) {
      takeSnapshot(word);
    }
  });
  state.stt.onError((msg) => {
    els.heard.textContent = '音声認識エラー: ' + msg;
  });
  state.stt.start();

  // タイマー（残り時間表示 + 自動終了）
  startTimers();

  show('recording');
}

// =====================================================================
// スナップショット（低遅延: ローカル canvas 描画のみ）
// =====================================================================
async function takeSnapshot(triggerWord) {
  const tSec = (Date.now() - state.startedAt) / 1000;
  flash();
  try {
    const blob = await state.capture.capture();
    state.shots.push({ blob, triggerWord, tSec });
    els.shotCount.textContent = `${state.shots.length}枚`;
    addThumb(blob, triggerWord);
  } catch (err) {
    console.error('snapshot失敗', err);
  }
}

function flash() {
  els.flash.classList.remove('on');
  // reflow を挟んでアニメ再生
  void els.flash.offsetWidth;
  els.flash.classList.add('on');
}

function addThumb(blob, word) {
  const url = URL.createObjectURL(blob);
  const fig = document.createElement('figure');
  fig.className = 'thumb';
  const img = document.createElement('img');
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
  const cap = document.createElement('figcaption');
  cap.textContent = word;
  fig.append(img, cap);
  els.thumbs.prepend(fig);
}

// ---- タイマー ----
function startTimers() {
  updateTimerLabel();
  state.tickTimer = setInterval(updateTimerLabel, 250);
  state.autoEndTimer = setTimeout(() => endSession('auto'), AUTO_END_MS);
}

function updateTimerLabel() {
  const remain = Math.max(0, AUTO_END_MS - (Date.now() - state.startedAt));
  const s = Math.ceil(remain / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  els.timer.textContent = `${mm}:${ss}`;
}

function clearTimers() {
  clearTimeout(state.autoEndTimer);
  clearInterval(state.tickTimer);
  state.autoEndTimer = null;
  state.tickTimer = null;
}

function stopStream() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
}

// =====================================================================
// 撮影終了 → アルバム生成
// =====================================================================
async function endSession(reason) {
  // 多重実行ガード: 手動終了と自動終了がほぼ同時に発火しても、
  // 先に呼ばれた1回だけを処理する（後続の auto による上書きを防ぐ）。
  if (!state.sessionActive) return;
  state.sessionActive = false;

  clearTimers();
  if (state.stt) state.stt.stop();
  stopStream();

  show('processing');
  // 自動終了（1分経過）のときだけ案内を出す。手動終了では何も出さない。
  els.processingSub.textContent =
    reason === 'auto' ? '（1分経過のため自動終了しました）' : '';

  if (state.shots.length === 0) {
    toast('写真が撮れませんでした。合言葉を話しかけてみてください。');
    resetToHome();
    return;
  }

  try {
    const fd = new FormData();
    const meta = {
      sessionId: state.sessionId,
      photos: state.shots.map((s) => ({ triggerWord: s.triggerWord, tSec: s.tSec })),
    };
    fd.append('meta', JSON.stringify(meta));
    state.shots.forEach((s, i) => fd.append('photos', s.blob, `photo_${i}.jpg`));

    const r = await fetch('/api/album/generate', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'アルバム生成に失敗しました');

    els.albumTitle.textContent = j.title || 'おもいでアルバム';
    els.albumVideo.src = j.albumUrl + '?t=' + Date.now(); // キャッシュ回避
    els.previewNote.textContent = `${j.photoCount}枚の写真からアルバムを作成しました。`;
    show('preview');
  } catch (err) {
    toast('生成エラー: ' + err.message, 4000);
    resetToHome();
  }
}

// =====================================================================
// 保存
// =====================================================================
async function saveAlbum() {
  els.btnSave.disabled = true;
  try {
    const stamp = nowStamp();
    const r = await fetch('/api/album/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, stamp }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || '保存に失敗しました');
    toast('保存しました: ' + j.fileName, 3200);
    setTimeout(resetToHome, 1200);
  } catch (err) {
    toast('保存エラー: ' + err.message, 4000);
  } finally {
    els.btnSave.disabled = false;
  }
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// =====================================================================
// ホームに戻る
// =====================================================================
function resetToHome() {
  clearTimers();
  if (state.stt) { state.stt.stop(); state.stt = null; }
  stopStream();
  state.shots = [];
  state.sessionId = null;
  els.albumVideo.removeAttribute('src');
  els.albumVideo.load?.();
  show('home');
}
