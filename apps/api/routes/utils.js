const express = require('express');
const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const { statements } = require('../db/database');
const router = express.Router();

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  if (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19) return true;
  if (parts[0] === 224) return true;
  if (parts[0] >= 240) return true;
  return false;
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase();
  return normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:169.254.') ||
    normalized.startsWith('::ffff:172.') ||
    normalized.startsWith('::ffff:192.168.');
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase();
  return host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'ip6-localhost' ||
    host === 'ip6-loopback' ||
    host.endsWith('.arpa');
}

function safePath(baseDir, relativePath) {
  const resolved = path.resolve(baseDir, relativePath);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error('Invalid path');
  }
  return resolved;
}

function setContentDisposition(res, filename) {
  const encoded = encodeURIComponent(filename).replace(/['()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "''");
  res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`);
}

function clampNumber(value, min, max, fallback = 0) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

function checkJobLimit(sessionId, isAdmin) {
  const MAX_ACTIVE_JOBS = 10;
  if (isAdmin) return;
  const total = statements.countActiveJobsTotal.get().count;
  if (total >= 50) throw new Error('Server queue is full. Please try again later.');
  if (sessionId) {
    const userCount = statements.countActiveJobsBySession.get(sessionId).count;
    if (userCount >= MAX_ACTIVE_JOBS) throw new Error('Too many active jobs. Please wait for current jobs to finish.');
  }
}

function createGuestSizeLimit(maxMB) {
  return (req, res, next) => {
    if (req.isAdmin) return next();
    const maxBytes = maxMB * 1024 * 1024;
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > maxBytes) {
      return res.status(413).json({ error: `File too large. Guest limit is ${maxMB}MB.` });
    }
    next();
  };
}

async function validatePublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Invalid URL scheme');
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('Blocked hostname');
  }

  const directType = net.isIP(parsed.hostname);
  if (directType === 4 && isPrivateIpv4(parsed.hostname)) {
    throw new Error('Blocked target address');
  }
  if (directType === 6 && isPrivateIpv6(parsed.hostname)) {
    throw new Error('Blocked target address');
  }

  const records = await dns.lookup(parsed.hostname, { all: true });
  for (const record of records) {
    if (record.family === 4 && isPrivateIpv4(record.address)) {
      throw new Error('Blocked target address');
    }
    if (record.family === 6 && isPrivateIpv6(record.address)) {
      throw new Error('Blocked target address');
    }
  }

  return parsed;
}

function fetchWithPinnedDns(parsed, options = {}) {
  return new Promise((resolve, reject) => {
    const { signal, timeout = 5000 } = options;

    const timeoutId = setTimeout(() => {
      req.destroy(new Error('Request timed out'));
    }, timeout);

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Host': parsed.host,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      lookup: (hostname, opts, cb) => {
        dns.lookup(hostname, { all: true, ...opts }).then(records => {
          for (const record of records) {
            if (record.family === 4 && isPrivateIpv4(record.address)) {
              return cb(new Error('Blocked target address'));
            }
            if (record.family === 6 && isPrivateIpv6(record.address)) {
              return cb(new Error('Blocked target address'));
            }
          }
          const preferred = records.find(r => r.family === 4) || records[0];
          cb(null, preferred.address, preferred.family);
        }).catch(cb);
      }
    };

    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(reqOptions, (res) => {
      clearTimeout(timeoutId);
      resolve(res);
    });

    req.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        req.destroy(new Error('Aborted'));
      });
    }

    req.end();
  });
}

router.get('/preview', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const validated = await validatePublicUrl(url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetchWithPinnedDns(validated, { signal: controller.signal, timeout: 5000 });

    clearTimeout(timeoutId);

    if (response.statusCode >= 300 && response.statusCode < 400) {
      return res.status(400).json({ error: 'Redirected URLs are not supported' });
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return res.status(response.statusCode).json({ error: 'Failed to fetch URL' });
    }

    const contentLength = Number(response.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024) {
      return res.status(413).json({ error: 'Page is too large for preview extraction' });
    }

    const contentType = response.headers['content-type'];
    if (contentType && !contentType.includes('text/html')) {
      if (contentType.includes('image/')) {
        return res.json({ image: validated.href });
      }
      return res.status(400).json({ error: 'URL does not point to an HTML page' });
    }

    const chunks = [];
    let totalSize = 0;
    for await (const chunk of response) {
      totalSize += chunk.length;
      if (totalSize > 2 * 1024 * 1024) {
        return res.status(413).json({ error: 'Page is too large for preview extraction' });
      }
      chunks.push(chunk);
    }
    const html = Buffer.concat(chunks).toString('utf8');

    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);

    const twitterImageMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["'][^>]*>/i);

    let imageUrl = null;
    if (ogImageMatch && ogImageMatch[1]) {
      imageUrl = ogImageMatch[1];
    } else if (twitterImageMatch && twitterImageMatch[1]) {
      imageUrl = twitterImageMatch[1];
    }

    if (!imageUrl) {
      return res.json({ image: null });
    }

    try {
      const absoluteImageUrl = new URL(imageUrl, validated.href).href;
      return res.json({ image: absoluteImageUrl });
    } catch (e) {
      return res.json({ image: imageUrl });
    }

  } catch (error) {
    const msg = error?.message || 'Failed to extract preview';
    if (
      msg.includes('Invalid URL') ||
      msg.includes('Blocked') ||
      msg.includes('scheme') ||
      msg.includes('Redirected URLs')
    ) {
      return res.status(400).json({ error: msg });
    }

    console.error('Preview extraction error:', msg);
    res.status(500).json({ error: 'Failed to extract preview' });
  }
});

module.exports = router;
module.exports.validatePublicUrl = validatePublicUrl;
module.exports.safePath = safePath;
module.exports.setContentDisposition = setContentDisposition;
module.exports.clampNumber = clampNumber;
module.exports.checkJobLimit = checkJobLimit;
module.exports.createGuestSizeLimit = createGuestSizeLimit;
