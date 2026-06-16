// Express サーバ: 静的配信 + アルバム生成/保存 API。
// album.js(ffmpeg) と ai.js(Claude) を呼び出してオーケストレーションする。
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { config } from './config.js';
import { generateAlbumText } from './ai.js';
import { buildAlbum } from './album.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));

// captures/ 配下を静的配信（生成済みアルバムのプレビュー再生に使用）
app.use('/captures', express.static(config.capturesDir));

// 画像は multer でメモリ受けし、セッションディレクトリへ書き出す
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// セッション開始: sessionId 発行とディレクトリ作成
app.post('/api/session/start', async (req, res) => {
  const sessionId = randomUUID();
  await fs.mkdir(join(config.capturesDir, sessionId), { recursive: true });
  res.json({ sessionId });
});

// アルバム生成: 画像群 + メタ → Claude でタイトル/キャプション → ffmpeg で mp4
// multipart: files 'photos'（順序通り）, field 'meta' = JSON { sessionId, photos:[{triggerWord,tSec}] }
app.post('/api/album/generate', upload.array('photos'), async (req, res) => {
  try {
    const meta = JSON.parse(req.body.meta || '{}');
    const sessionId = meta.sessionId;
    const photosMeta = Array.isArray(meta.photos) ? meta.photos : [];
    const files = req.files || [];

    if (!sessionId) return res.status(400).json({ error: 'sessionId がありません' });
    if (files.length === 0) return res.status(400).json({ error: '写真が1枚もありません' });

    const sessionDir = join(config.capturesDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    // 画像をセッションディレクトリへ書き出し（順序を保つゼロ埋め名）
    const photoPaths = [];
    for (let i = 0; i < files.length; i++) {
      const p = join(sessionDir, `photo_${String(i).padStart(3, '0')}.jpg`);
      await fs.writeFile(p, files[i].buffer);
      photoPaths.push(p);
    }

    // テキストAI（タイトル+キャプション）。キー未設定/失敗時はフォールバックされる。
    const { title, captions } = await generateAlbumText(
      photoPaths.map((_, i) => ({
        triggerWord: photosMeta[i]?.triggerWord ?? '',
        tSec: photosMeta[i]?.tSec ?? 0,
      }))
    );

    // ffmpeg でアルバム mp4 を生成
    const outputPath = join(sessionDir, 'album.mp4');
    await buildAlbum({ photoPaths, title, captions, outputPath });

    res.json({
      albumUrl: `/captures/${sessionId}/album.mp4`,
      title,
      captions,
      photoCount: photoPaths.length,
    });
  } catch (err) {
    console.error('[generate] エラー:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// アルバム保存: 生成済み mp4 を albums/ へ確定保存
app.post('/api/album/save', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId がありません' });

    const src = join(config.capturesDir, sessionId, 'album.mp4');
    await fs.access(src); // 存在確認（無ければ例外）

    await fs.mkdir(config.albumsDir, { recursive: true });
    // タイムスタンプは呼び出し側(クライアント)から渡す。無ければ sessionId 先頭を使う。
    const stamp = (req.body.stamp || sessionId.slice(0, 8)).replace(/[^0-9A-Za-z_-]/g, '');
    const destName = `album_${stamp}.mp4`;
    const dest = join(config.albumsDir, destName);
    await fs.copyFile(src, dest);

    res.json({ savedPath: dest, fileName: destName });
  } catch (err) {
    console.error('[save] エラー:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.listen(config.port, () => {
  console.log(`SoundSnap MVP 起動: http://localhost:${config.port}`);
  console.log(`保存先(albums): ${config.albumsDir}`);
  if (!process.env.OPENAI_API_KEY) {
    console.log('OPENAI_API_KEY 未設定 → タイトル/キャプションはフォールバックで動作します');
  }
});
