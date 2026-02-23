const express = require('express');
const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tooladmin1234';

// In-memory IP rate limiting for login attempts
const loginAttempts = new Map(); // ip -> { count, blockedUntil }

const MAX_ATTEMPTS = 3;
const BLOCK_DURATION = 30 * 60 * 1000; // 30 minutes

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
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection.remoteAddress;
    const { password } = req.body;

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

    if (password === ADMIN_PASSWORD) {
        // Success — clear attempts for this IP
        loginAttempts.delete(ip);
        res.json({ success: true, token: password });
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

// GET /api/auth/verify - check if token is valid
router.get('/verify', (req, res) => {
    const token = req.headers['x-admin-token'];
    res.json({ isAdmin: token === ADMIN_PASSWORD });
});

module.exports = router;
