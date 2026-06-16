# SoundSnap MVP 本番コンテナ
# ffmpeg（drawtext 字幕焼き込み対応）と日本語フォント(Noto CJK)を同梱する。
FROM node:20-bookworm-slim

# ffmpeg と日本語フォントをインストール
#  - ffmpeg: Debian の apt 版は libfreetype 有効ビルドで drawtext が使える
#  - fonts-noto-cjk: 字幕/タイトルの日本語表示用フォント
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存のインストール（本番依存のみ）。package-lock.json を利用して再現性を確保。
COPY package*.json ./
RUN npm ci --omit=dev

# アプリ本体をコピー
COPY . .

# Express は process.env.PORT を参照する（config.js）
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
