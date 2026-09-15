import crypto from 'crypto';
import { RedisDistributedLockManager } from './redis-lock.manager.js';
import { isRedisAvailable } from '../../database/redis.client.js';

export interface IdempotencyEntry {
  key: string;
  payloadHash: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  responseStatusCode?: number;
  responseBody?: any;
  createdAt: number;
  expiresAt: number;
  lockToken?: string;
}

export class IdempotencyManager {
  private static instance: IdempotencyManager;
  private cache: Map<string, IdempotencyEntry> = new Map();
  private redisLockManager: RedisDistributedLockManager;
  private readonly defaultTtlMs: number;

  private constructor(ttlSeconds = 86400) {
    this.defaultTtlMs = ttlSeconds * 1000;
    this.redisLockManager = RedisDistributedLockManager.getInstance();
    setInterval(() => this.cleanupExpiredKeys(), 10 * 60 * 1000).unref();
  }

  public static getInstance(ttlSeconds = 86400): IdempotencyManager {
    if (!IdempotencyManager.instance) {
      IdempotencyManager.instance = new IdempotencyManager(ttlSeconds);
    }
    return IdempotencyManager.instance;
  }

  public hashPayload(payload: any): string {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Acquire lock via Redis Distributed Lock (or local in-memory lock if Redis is offline)
   */
  public async acquireLock(
    key: string,
    payload: any,
    ttlMs?: number
  ): Promise<{
    acquired: boolean;
    lockToken?: string;
    inFlight?: boolean;
    mismatch?: boolean;
    cachedResponse?: { statusCode: number; body: any };
  }> {
    const now = Date.now();
    const payloadHash = this.hashPayload(payload);

    // 1. Check local in-memory cache first
    const existing = this.cache.get(key);
    if (existing) {
      if (existing.expiresAt < now) {
        this.cache.delete(key);
      } else if (existing.payloadHash !== payloadHash) {
        return { acquired: false, mismatch: true };
      } else if (existing.status === 'PROCESSING') {
        return { acquired: false, inFlight: true };
      } else if (existing.status === 'COMPLETED' && existing.responseBody) {
        return {
          acquired: false,
          cachedResponse: {
            statusCode: existing.responseStatusCode || 200,
            body: existing.responseBody,
          },
        };
      }
    }

    // 2. Try Redis Distributed Lock if available
    try {
      const redisUp = await isRedisAvailable();
      if (redisUp) {
        const redisResult = await this.redisLockManager.acquireLock(
          key,
          payload,
          Math.floor((ttlMs || this.defaultTtlMs) / 1000)
        );

        if (redisResult.inFlight || redisResult.mismatch || redisResult.cachedResponse) {
          return redisResult;
        }

        if (redisResult.acquired) {
          this.cache.set(key, {
            key,
            payloadHash,
            status: 'PROCESSING',
            createdAt: now,
            expiresAt: now + (ttlMs || this.defaultTtlMs),
            lockToken: redisResult.lockToken,
          });
          return redisResult;
        }
      }
    } catch {}

    // 3. Fallback to Local In-Memory Idempotency Lock
    const expiration = now + (ttlMs || this.defaultTtlMs);
    const lockToken = crypto.randomUUID();
    this.cache.set(key, {
      key,
      payloadHash,
      status: 'PROCESSING',
      createdAt: now,
      expiresAt: expiration,
      lockToken,
    });

    return { acquired: true, lockToken };
  }

  /**
   * Save completed response to Redis and in-memory store
   */
  public async saveResponse(
    key: string,
    statusCode: number,
    responseBody: any,
    payload?: any,
    lockToken?: string
  ): Promise<void> {
    const existing = this.cache.get(key);

    // Save to in-memory store
    if (existing) {
      existing.status = 'COMPLETED';
      existing.responseStatusCode = statusCode;
      existing.responseBody = responseBody;
    }

    // Save to Redis if available
    try {
      const redisUp = await isRedisAvailable();
      if (redisUp) {
        const dataPayload = payload || existing?.payloadHash || {};
        await this.redisLockManager.saveResponse(
          key,
          lockToken || existing?.lockToken,
          statusCode,
          responseBody,
          dataPayload
        );
      }
    } catch {}
  }

  /**
   * Release lock on failure
   */
  public async releaseLock(key: string, lockToken?: string): Promise<void> {
    const existing = this.cache.get(key);
    try {
      const redisUp = await isRedisAvailable();
      if (redisUp) {
        await this.redisLockManager.releaseLock(key, lockToken || existing?.lockToken);
      }
    } catch {}
    this.cache.delete(key);
  }

  private cleanupExpiredKeys(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }

  public async clear(): Promise<void> {
    this.cache.clear();
    await this.redisLockManager.clearAll();
  }
}
