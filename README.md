# DFS — Downloading For Society

Free multi-platform video downloader. Paste links from YouTube, TikTok, Instagram, X/Twitter, Facebook and 15+ other platforms — download singly or as playlists.

## Features

- **Single downloads** — multiple links at once, with per-link status and overall progress
- **Playlist downloads** — paste any playlist URL, 4-strategy fallback for unsupported sites
- **Dark / light theme** — one-click toggle, persisted across visits
- **20+ platforms** — YouTube, Spotify, SoundCloud, TikTok, Instagram, Facebook, X/Twitter, Vimeo, Twitch, Reddit and more

## Tech stack

| Layer    | Tech                          |
|----------|-------------------------------|
| Frontend | Vanilla HTML / CSS / JS       |
| Backend  | Node.js + Express             |
| Engine   | [yt-dlp](https://github.com/yt-dlp/yt-dlp) (system binary) |

## Prerequisites

- Node.js 18+
- `yt-dlp` on your `PATH` (`~/.local/bin` also works)
- `ffmpeg` recommended (merging separate audio/video streams)

## Run locally

```bash
npm install
npm start
```

Open **http://localhost:3001**. Downloads land in `~/Downloads/DFS`.

## Project structure

```
├── index.html        # UI (single + playlist tabs)
├── css/style.css     # theme, layout
├── js/app.js         # frontend logic (same-origin API in prod, localhost:3001 in dev)
├── server/server.js  # Express API + static hosting
├── package.json
└── package-lock.json
```

## API

| Method | Endpoint        | Purpose                              |
|--------|-----------------|--------------------------------------|
| GET    | `/api/health`   | yt-dlp availability check            |
| POST   | `/api/download` | download one video (`{ url }`)       |
| POST   | `/api/playlist` | download a playlist (`{ url }`)      |

## Deploy

The backend needs a real server (it shells out to `yt-dlp`), so **GitHub Pages alone is not enough** — Pages can host the UI, but downloads require the Node backend. Recommended hosts:

- **Render / Railway / VPS** — `npm install && npm start`; the server reads `process.env.PORT` automatically and serves the frontend itself, so one service is all you need. Make sure `yt-dlp` (+ `ffmpeg`) is installed on the host.
- **Docker** (VPS) — install node, copy the repo, `npm install --omit=dev`, run `node server/server.js`.

## License

UNLICENSED — all rights reserved.
