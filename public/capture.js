// 差し替え可能な「撮影アクション」。
// 現状はライブ <video> を <canvas> に描画してフレームを JPEG 取得する（ネットワーク非依存=低遅延）。
// 将来は capture() の中身を外部カメラ(DSLR)のシャッター API 呼び出しに差し替える拡張点。

export class CanvasCapture {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.canvas = document.createElement('canvas'); // オフスクリーン
    this.ctx = this.canvas.getContext('2d');
  }

  // 現在のフレームを JPEG Blob として返す。可能な限り同期的に描画してラグを最小化する。
  capture() {
    const v = this.videoEl;
    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;

    // drawImage は同期。ここで「その瞬間」のフレームが確定する。
    this.ctx.drawImage(v, 0, 0, w, h);

    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('スナップショットの生成に失敗しました'))),
        'image/jpeg',
        0.92
      );
    });
  }
}
