const express = require('express');
const router = express.Router();

router.get('/preview', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        // Basic validation to prevent SSRF-like behavior on internal IPs could go here
        // For now, accept standard http/https
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return res.status(400).json({ error: 'Invalid URL scheme' });
        }

        // Set a timeout to prevent hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch URL' });
        }

        // Only process HTML
        const contentType = response.headers.get('content-type');
        if (contentType && !contentType.includes('text/html')) {
            // If it's an image directly, just return it
            if (contentType.includes('image/')) {
                return res.json({ image: url });
            }
            return res.status(400).json({ error: 'URL does not point to an HTML page' });
        }

        const html = await response.text();

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
            const absoluteImageUrl = new URL(imageUrl, url).href;
            return res.json({ image: absoluteImageUrl });
        } catch (e) {
            return res.json({ image: imageUrl }); // Return as is if URL parsing fails
        }

    } catch (error) {
        console.error('Preview extraction error:', error.message);
        res.status(500).json({ error: 'Failed to extract preview' });
    }
});

module.exports = router;
