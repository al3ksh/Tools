# Tools

A self-hosted media toolkit with a modern web UI. Download videos, convert audio, shorten URLs, and share files — all from one dashboard.

![Dashboard](https://img.shields.io/badge/stack-Node.js%20%7C%20React%20%7C%20Docker-blue)

## Features

- **Universal Downloader** — YouTube, TikTok, Instagram, Twitter & 1000+ sites via `yt-dlp`
- **Audio Converter** — MP3, FLAC, WAV, Opus with FFmpeg loudness normalization
- **Link Shortener** — Custom slugs with click tracking
- **File Drop** — Upload and share files via unique links
- **Admin Panel** — Shared admin account with unlimited uploads, no file expiration
- **Per-Session Data** — Each guest gets isolated history via browser session
- **Dark / Light Mode** — Toggleable theme

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/)

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/tools.git
cd tools

# 2. Create your .env file
cp .env.example .env
# Edit .env and set a strong ADMIN_PASSWORD

# 3. Start the application
docker compose up -d --build

# 4. Open in browser
# http://localhost:3000
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ADMIN_PASSWORD` | `changeme` | Password for the admin panel |
| `DATA_DIR` | `/data` | Data directory inside the container |
| `PORT` | `3001` | Internal API port (mapped to 3000 externally) |

## Architecture

```
tools/
├── apps/
│   ├── api/          # Express.js REST API + static file server
│   │   ├── db/       # SQLite schema, migrations, prepared statements
│   │   ├── routes/   # API route handlers
│   │   └── src/      # Server entry point
│   ├── web/          # React (Vite) frontend
│   │   └── src/
│   │       ├── components/   # Reusable UI components
│   │       └── pages/        # Page-level components
│   └── worker/       # Background job processor (yt-dlp, ffmpeg)
├── packages/
│   └── shared/       # Shared types and constants
├── data/             # Persistent storage (SQLite DB, uploaded files)
├── docker-compose.yml
├── Dockerfile.web    # API + Web build
└── Dockerfile.worker # Worker build
```

## Roles

### Guest (default)
- Unique session stored in `localStorage` (persists until browser data is cleared)
- Files expire **1 hour** after creation
- Upload limits: **50 MB** (Drop), **500 MB** (Converter)

### Admin
- Shared session across all devices — same data everywhere
- Files **never expire** (manual delete only)
- **No upload size limits**
- Login via the "Guest Session" text in the sidebar
- **Brute force protection**: 3 failed attempts → 30 minute IP block

## Deployment (Raspberry Pi)

1. Install Docker on your Pi: `curl -fsSL https://get.docker.com | sh`
2. Clone and set up as above
3. Use a reverse proxy (Caddy or Nginx) for HTTPS:

```
# Example Caddyfile
tools.yourdomain.com {
    reverse_proxy localhost:3000
}
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Admin login (rate-limited) |
| `GET` | `/api/auth/verify` | Verify admin token |
| `GET` | `/api/jobs` | List jobs (filtered by session) |
| `GET` | `/api/jobs/:id` | Job details |
| `DELETE` | `/api/jobs/:id` | Delete a job |
| `POST` | `/api/jobs/:id/cancel` | Cancel a job |
| `POST` | `/api/downloader` | Create download job |
| `POST` | `/api/upload/upload` | Upload file for conversion |
| `POST` | `/api/converter` | Create conversion job |
| `POST` | `/api/shorten` | Create short link |
| `GET` | `/api/shortlinks/list` | List short links |
| `POST` | `/api/drop/upload` | Upload a drop file |
| `GET` | `/api/drop/list` | List drops |
| `GET` | `/api/drop/:token/download` | Download a drop |
| `GET` | `/api/files/:jobId` | Download job output |
| `GET` | `/api/storage` | Storage usage |
| `GET` | `/api/health` | Health check |

## Tech Stack

- **Frontend**: React 18, Vite, Lucide Icons
- **Backend**: Node.js, Express, better-sqlite3
- **Worker**: yt-dlp, FFmpeg
- **Infra**: Docker Compose, SQLite

## License

MIT
