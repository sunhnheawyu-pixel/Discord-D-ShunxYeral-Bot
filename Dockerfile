FROM node:24.17.0-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24.17.0-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data
CMD ["node", "dist/index.js"]
