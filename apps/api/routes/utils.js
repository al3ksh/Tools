const express = require('express');
const dns = require('dns').promises;
const net = require('net');
const router = express.Router();

function isPrivateIpv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
}

function isPrivateIpv6(ip) {
    const normalized = ip.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80');
}

function isBlockedHostname(hostname) {
    const host = hostname.toLowerCase();
    return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
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

router.get('/preview', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const validated = await validatePublicUrl(url);

        // Set a timeout to prevent hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(validated.href, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            },
            signal: controller.signal,
            redirect: 'manual'
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch URL' });
        }

        if (response.status >= 300 && response.status < 400) {
            return res.status(400).json({ error: 'Redirected URLs are not supported' });
        }

        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024) {
            return res.status(413).json({ error: 'Page is too large for preview extraction' });
        }

        // Only process HTML
        const contentType = response.headers.get('content-type');
        if (contentType && !contentType.includes('text/html')) {
            // If it's an image directly, just return it
            if (contentType.includes('image/')) {
                return res.json({ image: validated.href });
            }
            return res.status(400).json({ error: 'URL does not point to an HTML page' });
        }

        const html = (await response.text()).slice(0, 2 * 1024 * 1024);

        // Extract og:image using regex
        const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
            html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);

        // Extract twitter:image as fallback
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

        // Handle relative URLs
        try {
            const absoluteImageUrl = new URL(imageUrl, validated.href).href;
            return res.json({ image: absoluteImageUrl });
        } catch (e) {
            return res.json({ image: imageUrl }); // Return as is if URL parsing fails
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
