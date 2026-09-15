import crypto from 'crypto';
import { getRedisClient, isRedisAvailable } from '../../database/redis.client.js';

export interface LockResult {
  acquired: boolean;
  lockToken?: string;
  inFlight?: boolean;
  mismatch?: boolean;
  cachedResponse?: { statusCode: number; body: any };
}

export class RedisDistributedLockManager {
  private static instance: RedisDistributedLockManager;

  // Lua script to safely release lock only if the token matches
  private static readonly RELEASE_LOCK_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  private constructor() {}

  public static getInstance(): RedisDistributedLockManager {
    if (!RedisDistributedLockManager.instance) {
      RedisDistributedLockManager.instance = new RedisDistributedLockManager();
    }
    return RedisDistributedLockManager.instance;
  }

  /**
   * Acquire a distributed lock in Redis with payload hashing & response caching
   */
  public async acquireLock(
    key: string,
    payload: any,
    ttlSeconds = 86400
  ): Promise<LockResult> {
    const isUp = await isRedisAvailable();
    if (!isUp) {
      return { acquired: false };
    }

    const redis = getRedisClient();
    const lockKey = `lock:idempotency:${key}`;
    const dataKey = `data:idempotency:${key}`;
    const lockToken = crypto.randomUUID();
    const payloadHash = this.hashPayload(payload);

    try {
      // 1. Check if cached response already exists in Redis
      const existingData = await redis.get(dataKey);
      if (existingData) {
        const parsed = JSON.parse(existingData);
        if (parsed.payloadHash !== payloadHash) {
          return { acquired: false, mismatch: true };
        }
        if (parsed.status === 'COMPLETED' && parsed.responseBody) {
          return {
            acquired: false,
            cachedResponse: {
              statusCode: parsed.statusCode || 200,
              body: parsed.responseBody,
            },
          };
        }
        if (parsed.status === 'PROCESSING') {
          return { acquired: false, inFlight: true };
        }
      }

      // 2. Attempt atomic lock: SET key lockToken NX EX <ttlSeconds>
      const lockAcquired = await redis.set(lockKey, lockToken, 'EX', 30, 'NX');
      if (!lockAcquired) {
        return { acquired: false, inFlight: true };
      }

      // 3. Mark key state in Redis as PROCESSING
      await redis.set(
        dataKey,
        JSON.stringify({
          payloadHash,
          status: 'PROCESSING',
          createdAt: Date.now(),
        }),
        'EX',
        ttlSeconds
      );

      return { acquired: true, lockToken };
    } catch {
      return { acquired: false };
    }
  }

  /**
   * Save completed response into Redis cache
   */
  public async saveResponse(
    key: string,
    lockToken: string | undefined,
    statusCode: number,
    responseBody: any,
    payload: any,
    ttlSeconds = 86400
  ): Promise<void> {
    const isUp = await isRedisAvailable();
    if (!isUp) return;

    const redis = getRedisClient();
    const lockKey = `lock:idempotency:${key}`;
    const dataKey = `data:idempotency:${key}`;

    try {
      let payloadHash: string;
      if (typeof payload === 'string' && /^[0-9a-f]{64}$/i.test(payload)) {
        payloadHash = payload;
      } else if (payload && Object.keys(payload).length > 0) {
        payloadHash = this.hashPayload(payload);
      } else {
        const existingData = await redis.get(dataKey);
        payloadHash = existingData ? JSON.parse(existingData).payloadHash : this.hashPayload({});
      }

      // Save cached response
      await redis.set(
        dataKey,
        JSON.stringify({
          payloadHash,
          status: 'COMPLETED',
          statusCode,
          responseBody,
          createdAt: Date.now(),
        }),
        'EX',
        ttlSeconds
      );

      // Release in-flight lock using safe token match
      if (lockToken) {
        await redis.eval(
          RedisDistributedLockManager.RELEASE_LOCK_SCRIPT,
          1,
          lockKey,
          lockToken
        );
      } else {
        await redis.del(lockKey);
      }
    } catch {}
  }

  /**
   * Release lock on failure
   */
  public async releaseLock(key: string, lockToken?: string): Promise<void> {
    const isUp = await isRedisAvailable();
    if (!isUp) return;

    const redis = getRedisClient();
    const lockKey = `lock:idempotency:${key}`;
    const dataKey = `data:idempotency:${key}`;

    try {
      if (lockToken) {
        await redis.eval(
          RedisDistributedLockManager.RELEASE_LOCK_SCRIPT,
          1,
          lockKey,
          lockToken
        );
      } else {
        await redis.del(lockKey);
      }
      await redis.del(dataKey);
    } catch {}
  }

  /**
   * Clear all Redis test keys
   */
  public async clearAll(): Promise<void> {
    const isUp = await isRedisAvailable();
    if (!isUp) return;

    const redis = getRedisClient();
    try {
      const lockKeys = await redis.keys('lock:idempotency:*');
      const dataKeys = await redis.keys('data:idempotency:*');
      const allKeys = [...lockKeys, ...dataKeys];
      if (allKeys.length > 0) {
        await redis.del(...allKeys);
      }
    } catch {}
  }

  private hashPayload(payload: any): string {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }
}
