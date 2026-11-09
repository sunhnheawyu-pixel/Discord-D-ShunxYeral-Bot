FROM node:24.17.0-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24.17.0-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV YOUTUBE_DL_SKIP_DOWNLOAD=1
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/youtube-dl-exec/bin/yt-dlp ./node_modules/youtube-dl-exec/bin/yt-dlp

RUN mkdir -p /app/data
CMD ["node", "dist/index.js"]
