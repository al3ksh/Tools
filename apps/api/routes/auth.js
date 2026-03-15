const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.ADMIN_PASSWORD;

// In-memory IP rate limiting for login attempts
const loginAttempts = new Map(); // ip -> { count, blockedUntil }

const MAX_ATTEMPTS = 3;
const BLOCK_DURATION = 30 * 60 * 1000; // 30 minutes
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection.remoteAddress;
}

function passwordsMatch(input, expected) {
    if (typeof input !== 'string' || typeof expected !== 'string') return false;
    const inputBuffer = Buffer.from(input);
    const expectedBuffer = Buffer.from(expected);
    if (inputBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(inputBuffer, expectedBuffer);
}

function getAdminToken(req) {
    const headerToken = req.headers['x-admin-token'];
    if (headerToken) return headerToken;
    return req.cookies?.admin_token || null;
}

function verifyAdminToken(token) {
    if (!token || !ADMIN_JWT_SECRET) return false;
    try {
        const payload = jwt.verify(token, ADMIN_JWT_SECRET);
        return payload?.role === 'admin';
    } catch (err) {
        return false;
    }
}

function authCookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: TOKEN_TTL_MS,
        path: '/',
    };
}

// Cleanup old entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of loginAttempts) {
        if (data.blockedUntil && data.blockedUntil < now) {
            loginAttempts.delete(ip);
        }
    }
}, 10 * 60 * 1000);

// POST /api/auth/login - validate admin password
router.post('/login', (req, res) => {
    const ip = getClientIp(req);
    const { password } = req.body;

    if (!ADMIN_PASSWORD || !ADMIN_JWT_SECRET) {
        return res.status(503).json({ error: 'Admin auth is not configured on server.' });
    }

    // Check if IP is blocked
    const attempt = loginAttempts.get(ip);
    if (attempt && attempt.blockedUntil && Date.now() < attempt.blockedUntil) {
        const remainingMin = Math.ceil((attempt.blockedUntil - Date.now()) / 60000);
        return res.status(429).json({
            error: `Too many failed attempts. Try again in ${remainingMin} minutes.`,
            blockedFor: remainingMin
        });
    }

    if (!password) {
        return res.status(400).json({ error: 'Password is required' });
    }

    if (passwordsMatch(password, ADMIN_PASSWORD)) {
        // Success — clear attempts for this IP
        loginAttempts.delete(ip);

        const token = jwt.sign(
            { role: 'admin' },
            ADMIN_JWT_SECRET,
            { expiresIn: '12h' }
        );

        res.cookie('admin_token', token, authCookieOptions());
        res.json({ success: true });
    } else {
        // Failed — increment counter
        const current = loginAttempts.get(ip) || { count: 0, blockedUntil: null };
        current.count += 1;

        if (current.count >= MAX_ATTEMPTS) {
            current.blockedUntil = Date.now() + BLOCK_DURATION;
            loginAttempts.set(ip, current);
            return res.status(429).json({
                error: `Too many failed attempts. Blocked for 30 minutes.`,
                blockedFor: 30
            });
        }

        loginAttempts.set(ip, current);
        const remaining = MAX_ATTEMPTS - current.count;
        res.status(401).json({
            error: `Incorrect password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
        });
    }
});

// POST /api/auth/logout - remove admin session
router.post('/logout', (req, res) => {
    res.clearCookie('admin_token', {
        ...authCookieOptions(),
        maxAge: undefined,
    });
    res.json({ success: true });
});

// GET /api/auth/verify - check if token is valid
router.get('/verify', (req, res) => {
    const token = getAdminToken(req);
    res.json({ isAdmin: verifyAdminToken(token) });
});

module.exports = router;
