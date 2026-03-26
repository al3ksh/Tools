# AGENTS.md — Tools Monorepo

## Project Overview

Self-hosted media toolkit: video downloading, audio conversion, URL shortening, file sharing.
Monorepo with npm workspaces. Docker-based deployment on Node.js 20 Alpine.

```
apps/api/       — Express 4 REST API + static file server (CommonJS)
apps/web/       — React 18 + Vite 5 frontend (ESM)
apps/worker/    — Background job processor: yt-dlp + ffmpeg (CommonJS)
packages/shared/ — Shared constants (PRESETS, JOB_STATUS, JOB_TYPE)
```

## Build / Dev / Run Commands

```bash
# Start all services concurrently (api :3001, web :3000, worker)
npm run dev

# Build web frontend (Vite → apps/web/dist/)
npm run build

# Start individual services
npm run dev --workspace=apps/api
npm run dev --workspace=apps/web
npm run dev --workspace=apps/worker

# Production start
npm run start --workspace=apps/api
npm run start --workspace=apps/worker

# Docker
docker compose up -d --build
```

There are **no lint, test, or format commands**. No ESLint, Prettier, Jest, Vitest, or any test framework is configured. If adding tests, prefer Vitest.

## Code Style

### Language

Plain JavaScript throughout. **No TypeScript. No JSDoc. No type annotations.**

### Module System

- `apps/api/`, `apps/worker/`, `packages/shared/` — CommonJS (`require` / `module.exports`)
- `apps/web/` — ESM (`import` / `export default`, `"type": "module"` in package.json)

### Imports

Order: external packages → Node built-ins → local modules. No blank line separators.

```js
// CommonJS (api, worker, shared)
const express = require('express');
const path = require('path');
const { statements } = require('../db/database');

// ESM (web)
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { getJobs } from '../api';
import './index.css';
```

### Naming Conventions

| Category | Convention | Examples |
|---|---|---|
| Variables / functions | camelCase | `sessionId`, `handleSubmit`, `formatBytes` |
| Constants | UPPER_SNAKE_CASE | `DATA_DIR`, `MAX_ATTEMPTS`, `PRESETS` |
| React components | PascalCase | `Dashboard`, `FileUploader`, `AudioTrimmer` |
| Component files | PascalCase `.jsx` | `Dashboard.jsx`, `AdminPanel.jsx` |
| Route paths | kebab-case | `/api/shortlinks`, `/api/images-to-pdf` |
| CSS classes | kebab-case | `.card-body`, `.btn-primary`, `.status-queued` |
| CSS variables | kebab-case | `--bg-primary`, `--text-secondary` |
| Event handlers | camelCase, `handle` prefix | `handleSubmit`, `handleDelete` |
| SQL columns | camelCase | `createdAt`, `sessionId`, `targetUrl` |
| Env variables | UPPER_SNAKE_CASE | `ADMIN_PASSWORD`, `CORS_ORIGINS` |

### Function Style

- **Utility/helper functions**: regular `function` declarations
- **Route handlers**: arrow functions or inline anonymous callbacks
- **React components**: named `function` declarations with `export default`

```js
// Utility
function formatBytes(bytes) { ... }

// Route handler
router.post('/', (req, res) => { ... });

// Arrow utility
const getAdminToken = (req) => { ... };

// React component
function Dashboard({ sessionId }) { ... }
export default Dashboard;
```

### Indentation & Formatting

- 2-space indentation
- No trailing commas (shared package) — be consistent within the file you're editing
- Single quotes for strings in backend; double quotes acceptable in JSX
- No semicolons are NOT used — semicolons ARE used throughout the codebase

### Error Handling (API)

Every route handler wraps logic in `try/catch`. Errors return JSON `{ error: message }`.

```js
router.post('/', (req, res) => {
  try {
    if (!url) return res.status(400).json({ error: 'URL is required' });
    // ... logic ...
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- Input validation: early return with 400/403/404/413 status
- Multer upload errors: handled via router-level error middleware (`err instanceof multer.MulterError`)
- No custom error classes, no centralized error handler

### Error Handling (Web)

```js
const handleSubmit = async (e) => {
  e.preventDefault();
  setLoading(true);
  setError('');
  try {
    await api.createJob(url, sessionId);
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
};
```

### Database (SQLite via better-sqlite3)

- Synchronous driver — all DB calls are blocking, no async needed
- All queries use pre-compiled prepared statements (defined in `db/database.js`)
- Inline migration pattern: check column existence via `PRAGMA table_info`, ALTER TABLE if missing
- `.get()` for single row, `.all()` for multiple rows, `.run()` for mutations

### React Patterns

- **State**: `useState` / `useEffect` only. No external state library.
- **Data fetching**: raw `fetch` via centralized `api.js` module, with `setInterval` polling (2-5s)
- **Styling**: global CSS (`src/index.css`, ~1400 lines) with CSS custom properties for dark/light themes + extensive inline styles
- **No CSS modules, no Tailwind, no styled-components**
- **Toast pattern** (duplicated in each page):
  ```js
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  ```
- **Persistence**: `localStorage` for session ID, theme, admin token

### Comments

Sparse. Only section headers when needed. No inline comments explaining business logic. No JSDoc.

## Architecture

- **API** serves the web build in production (`apps/web/dist/` as static files with SPA fallback)
- **Worker** polls SQLite every 1s for queued jobs, processes via `child_process.spawn` (yt-dlp / ffmpeg), streams progress to DB
- **Job lifecycle**: `queued` → `running` → `done` / `failed` / `expired`
- **Guest sessions**: isolated data via `localStorage` session ID, files expire after 1 hour
- **Admin**: JWT cookie auth, no file expiration, no upload size limits, shared across devices
- **Cancellation**: API sets `isCancelling = 1`, worker sends SIGKILL to active child process

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | (none) | Admin login password |
| `ADMIN_JWT_SECRET` | falls back to `ADMIN_PASSWORD` | JWT signing secret |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed origins |
| `DATA_DIR` | `/data` | SQLite DB + uploaded files directory |
| `PORT` | `3001` | API server port |
| `NODE_ENV` | (none) | Enables secure cookie flag when `production` |

## Security Notes

- SSRF protection on URL inputs: DNS resolution check, private IP blocking, protocol enforcement (http/https only)
- Timing-safe password comparison via `crypto.timingSafeEqual`
- Rate limiting: 180 req/min on `/api/*` routes
- Helmet middleware with custom CSP
- Multer file size limits (admin bypasses): 50MB drop, 500MB converter, 100MB PDF
- Brute force protection: 3 failed login attempts → 30min IP block

## Shared Package

`packages/shared/types.js` exports `PRESETS`, `JOB_STATUS`, `JOB_TYPE`.
Imported by relative path: `require('../../../packages/shared/types')`.
Note: `package.json` declares `"main": "index.js"` but the file is actually `types.js`.

## Adding New Features

1. **New API route**: create file in `apps/api/routes/`, add prepared statements to `apps/api/db/database.js`, mount in `apps/api/src/index.js`
2. **New page**: create `.jsx` in `apps/web/src/pages/`, add route in `apps/web/src/App.jsx`, add nav link with Lucide icon
3. **New worker job type**: add handler in `apps/worker/src/index.js`, update shared types if needed
4. **Database changes**: modify `apps/api/db/schema.sql`, add inline migration in `database.js`
