const buckets = new Map();

/**
 * Lightweight in-memory rate limiter.
 *
 * Notes:
 * - keyed by requester IP and limiter prefix
 * - suitable for single-instance deployments
 * - should be replaced with shared storage (e.g. Redis) for multi-instance
 */

function createRateLimiter({ keyPrefix, windowMs, maxRequests, blockMs }) {
    return (req, res, next) => {
        // Prefer Express-derived ip, fallback to forwarded/socket address.
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        const key = `${keyPrefix}:${ip}`;
        const now = Date.now();

        const existing = buckets.get(key) || {
            windowStart: now,
            count: 0,
            blockedUntil: 0
        };

        // Hard block until ttl elapses once threshold has been exceeded.
        if (existing.blockedUntil > now) {
            return res.status(429).json({
                error: 'Too many requests. Please try again later.',
                retryAfterSeconds: Math.ceil((existing.blockedUntil - now) / 1000)
            });
        }

        // Reset rolling counter when request window expires.
        if (now - existing.windowStart > windowMs) {
            existing.windowStart = now;
            existing.count = 0;
        }

        existing.count += 1;

        if (existing.count > maxRequests) {
            existing.blockedUntil = now + blockMs;
            buckets.set(key, existing);
            return res.status(429).json({
                error: 'Too many requests. Please try again later.',
                retryAfterSeconds: Math.ceil(blockMs / 1000)
            });
        }

        buckets.set(key, existing);
        return next();
    };
}

// Dedicated limiter for OTP request endpoints (stricter, abuse-prone).
const otpRequestLimiter = createRateLimiter({
    keyPrefix: 'auth:otp',
    windowMs: 60 * 1000,
    maxRequests: Number(process.env.AUTH_OTP_REQUESTS_PER_MINUTE || 8),
    blockMs: Number(process.env.AUTH_OTP_BLOCK_MS || 5 * 60 * 1000)
});

// Broader limiter for verification/login/reset endpoints.
const authSensitiveLimiter = createRateLimiter({
    keyPrefix: 'auth:sensitive',
    windowMs: 60 * 1000,
    maxRequests: Number(process.env.AUTH_SENSITIVE_REQUESTS_PER_MINUTE || 20),
    blockMs: Number(process.env.AUTH_SENSITIVE_BLOCK_MS || 2 * 60 * 1000)
});

module.exports = {
    otpRequestLimiter,
    authSensitiveLimiter
};
