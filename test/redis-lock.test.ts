import { describe, it, expect, beforeEach } from 'vitest';
import { IdempotencyManager } from '../src/core/idempotency/idempotency.manager.js';

describe('Production Idempotency & Distributed Lock Layer', () => {
  let idempotency: IdempotencyManager;

  beforeEach(async () => {
    idempotency = IdempotencyManager.getInstance(3600);
    await idempotency.clear();
  });

  it('should acquire atomic lock and prevent double-debit race conditions', async () => {
    const payload = { merchantOrderId: 'ORD_CONCURRENT_1', amount: 500 };
    const lock1 = await idempotency.acquireLock('key_race_1', payload);
    expect(lock1.acquired).toBe(true);
    expect(lock1.lockToken).toBeDefined();

    // In-flight duplicate attempt must be rejected
    const lock2 = await idempotency.acquireLock('key_race_1', payload);
    expect(lock2.acquired).toBe(false);
    expect(lock2.inFlight).toBe(true);
  });

  it('should return cached response on subsequent idempotent requests', async () => {
    const payload = { merchantOrderId: 'ORD_CACHE_2', amount: 999 };
    const lock = await idempotency.acquireLock('key_cache_2', payload);
    expect(lock.acquired).toBe(true);

    const completedResponse = {
      transactionId: 'txn_cache_123',
      status: 'PENDING',
      amount: 999,
    };

    await idempotency.saveResponse(
      'key_cache_2',
      201,
      completedResponse,
      payload,
      lock.lockToken
    );

    // Duplicate request must return cached response without re-processing
    const replay = await idempotency.acquireLock('key_cache_2', payload);
    expect(replay.acquired).toBe(false);
    expect(replay.cachedResponse).toBeDefined();
    expect(replay.cachedResponse?.statusCode).toBe(201);
    expect(replay.cachedResponse?.body).toEqual(completedResponse);
  });

  it('should reject request when idempotency key is reused with different amount/payload', async () => {
    const payloadOriginal = { merchantOrderId: 'ORD_TAMPER_3', amount: 100 };
    await idempotency.acquireLock('key_tamper_3', payloadOriginal);

    const payloadTampered = { merchantOrderId: 'ORD_TAMPER_3', amount: 999 };
    const tamperedAttempt = await idempotency.acquireLock('key_tamper_3', payloadTampered);

    expect(tamperedAttempt.acquired).toBe(false);
    expect(tamperedAttempt.mismatch).toBe(true);
  });
});
