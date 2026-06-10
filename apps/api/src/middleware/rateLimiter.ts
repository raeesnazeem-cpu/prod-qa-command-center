import rateLimit from 'express-rate-limit'
import { Request } from 'express'

export const defaultRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
})

export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    return req.auth?.orgId ?? req.ip ?? 'unknown'
  },
  message: { error: 'AI rate limit exceeded. Maximum 10 requests per minute per organization.' },
})
