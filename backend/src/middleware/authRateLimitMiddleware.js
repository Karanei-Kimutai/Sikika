/**
 * authRateLimitMiddleware.js
 * --------------------------
 * Lightweight in-memory IP-based rate limiter for auth-sensitive endpoints.
 *
 * Two pre-built limiters are exported:
 *   - `otpRequestLimiter`   — strict limit for OTP send endpoints (abuse-prone)
 *   - `authSensitiveLimiter`— broader limit for verify/login/reset endpoints
 *
 * Each limiter tracks a sliding window per (keyPrefix + IP). Exceeding the
 * request threshold triggers a hard block for `blockMs` milliseconds, during
 * which all further requests are rejected with HTTP 429.
 *
 * Limitations:
 *   - State is process-local; rate limit resets on server restart.
 *   - Not shared across instances — replace with Redis for multi-instance deploys.
 *   - Window and block durations are tunable via env vars (AUTH_OTP_* / AUTH_SENSITIVE_*).
 *
 * @module authRateLimitMiddleware
 */

/**
 * In-memory store mapping "prefix:ip" → window/count/block state.
 * Entries are never evicted; memory growth is bounded by the number of unique
 * IPs that have made auth requests since the last process restart.
 *
 * @type {Map<string, { windowStart: number, count: number, blockedUntil: number }>}
 */
const buckets = new Map();

/**
 * Factory that returns an Express middleware function implementing a
 * fixed-window rate limiter with a hard-block penalty period.
 *
 * @param {object} options
 * @param {string} options.keyPrefix    - Namespace prefix; combined with IP to form the bucket key.
 * @param {number} options.windowMs     - Rolling window duration in milliseconds.
 * @param {number} options.maxRequests  - Maximum allowed requests within the window before blocking.
 * @param {number} options.blockMs      - Hard-block duration in milliseconds once the threshold is exceeded.
 * @returns {import('express').RequestHandler} Express middleware that enforces the rate limit.
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

/**
 * Strict rate limiter for OTP send endpoints (POST /api/auth/request-otp and
 * POST /api/auth/login-password, which both trigger SMS sends).
 *
 * Defaults: 8 requests/min; 5-minute block on breach.
 * Override via AUTH_OTP_REQUESTS_PER_MINUTE and AUTH_OTP_BLOCK_MS env vars.
 *
 * @type {import('express').RequestHandler}
 */
const otpRequestLimiter = createRateLimiter({
    keyPrefix: 'auth:otp',
    windowMs: 60 * 1000,
    maxRequests: Number(process.env.AUTH_OTP_REQUESTS_PER_MINUTE || 8),
    blockMs: Number(process.env.AUTH_OTP_BLOCK_MS || 5 * 60 * 1000)
});

/**
 * Broader rate limiter applied to verify/login/reset endpoints that don't
 * trigger SMS sends but are still sensitive to credential stuffing.
 *
 * Defaults: 20 requests/min; 2-minute block on breach.
 * Override via AUTH_SENSITIVE_REQUESTS_PER_MINUTE and AUTH_SENSITIVE_BLOCK_MS env vars.
 *
 * @type {import('express').RequestHandler}
 */
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
