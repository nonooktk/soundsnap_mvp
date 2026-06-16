// 差し替え可能な STT（Speech-to-Text）インターフェース。
// 現状は Web Speech API 実装。将来 Vosk(ローカル)/Cloud STT へ載せ替え可能なように
// start()/stop()/onResult(cb) のシンプルな I/F に揃える。
//
// 低遅延の要点:
//  - interimResults=true で「確定前」の途中結果も逐次受け取り、トリガー判定を即座に行う。
//  - continuous=true + onend での自動再起動で、撮影中は認識を途切れさせない。

export class WebSpeechSTT {
  constructor({ lang = 'ja-JP' } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      throw new Error('このブラウザは Web Speech API に未対応です。Chrome または Edge をご利用ください。');
    }
    this.SR = SR;
    this.lang = lang;
    this.recognition = null;
    this.running = false;
    this.resultCb = null; // (text, isFinal) => void
    this.errorCb = null;  // (message) => void
  }

  // 認識結果コールバック登録。text は interim/final いずれも渡す（isFinal で区別可能）。
  onResult(cb) { this.resultCb = cb; }
  onError(cb) { this.errorCb = cb; }

  start() {
    if (this.running) return;
    this.running = true;
    this._spawn();
  }

  _spawn() {
    const rec = new this.SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      // 直近の結果のみ処理（interim を含む）。
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (this.resultCb) this.resultCb(text, result.isFinal);
      }
    };

    rec.onerror = (e) => {
      // no-speech / aborted は無視して再起動に任せる。それ以外は通知。
      if (e.error && !['no-speech', 'aborted'].includes(e.error)) {
        if (this.errorCb) this.errorCb(e.error);
      }
    };

    rec.onend = () => {
      // continuous でも自動停止することがあるため、running 中は再起動して途切れさせない。
      if (this.running) {
        try { rec.start(); } catch { this._spawn(); }
      }
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // 直後の連続 start で例外になることがあるため再生成
      this._spawn();
    }
  }

  stop() {
    this.running = false;
    if (this.recognition) {
      try { this.recognition.stop(); } catch { /* noop */ }
      this.recognition.onend = null;
      this.recognition = null;
    }
  }
}
