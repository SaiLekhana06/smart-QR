import type { Request, Response, NextFunction } from 'express';

interface RateEntry {
  timestamps: number[];
}

export class SlidingWindowLimiter {
  private store = new Map<string, RateEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly message: string;

  constructor(options: { windowMs: number; maxRequests: number; message: string }) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.message = options.message;
  }

  check(key: string): { allowed: boolean; retryAfterSec: number; remaining: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const existing = this.store.get(key) || { timestamps: [] };
    const recent = existing.timestamps.filter((t) => t > cutoff);

    if (recent.length >= this.maxRequests) {
      const oldest = recent[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.store.set(key, { timestamps: recent });
      return { allowed: false, retryAfterSec, remaining: 0 };
    }

    recent.push(now);
    this.store.set(key, { timestamps: recent });
    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: Math.max(0, this.maxRequests - recent.length)
    };
  }

  middleware = (keyBuilder?: (req: Request) => string) => {
    return (req: Request, res: Response, next: NextFunction) => {
      // Allow test header bypass ONLY if test environment explicitly sets NODE_ENV === 'test'
      const ip =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        'unknown';
      const key = keyBuilder ? keyBuilder(req) : ip;
      const result = this.check(key);

      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSec));
        res.status(429).json({
          error: 'RATE_LIMITED',
          message: this.message,
          retryAfterSec: result.retryAfterSec
        });
        return;
      }

      next();
    };
  };
}
