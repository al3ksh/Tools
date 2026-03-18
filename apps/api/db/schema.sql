-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('download', 'convert')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'done', 'failed', 'expired', 'deleted')),
  progress INTEGER,
  createdAt TEXT NOT NULL,
  startedAt TEXT,
  finishedAt TEXT,
  expiresAt TEXT,
  deletedAt TEXT,
  deleted INTEGER DEFAULT 0,
  sessionId TEXT,
  inputJson TEXT,
  outputJson TEXT,
  error TEXT,
  logsTail TEXT
);

-- Shortlinks table
CREATE TABLE IF NOT EXISTS shortlinks (
  slug TEXT PRIMARY KEY,
  targetUrl TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  clicks INTEGER DEFAULT 0,
  sessionId TEXT
);

-- Drops table
CREATE TABLE IF NOT EXISTS drops (
  token TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  downloads INTEGER DEFAULT 0,
  expiresAt TEXT,
  deleted INTEGER DEFAULT 0,
  sessionId TEXT
);

-- Index for faster polling
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_jobs_expires ON jobs(expiresAt, status);
CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(sessionId);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_drops_session ON drops(sessionId);
CREATE INDEX IF NOT EXISTS idx_shortlinks_session ON shortlinks(sessionId);
