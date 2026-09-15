import { describe, it, expect, beforeEach } from 'vitest';
import { IdempotencyManager } from '../src/core/idempotency/idempotency.manager.js';

describe('IdempotencyManager', () => {
  let manager: IdempotencyManager;

  beforeEach(() => {
    manager = IdempotencyManager.getInstance(3600);
    manager.clear();
  });

  it('should acquire lock for a new idempotency key', async () => {
    const lock = await manager.acquireLock('key_1', { orderId: 'ORD_001', amount: 100 });
    expect(lock.acquired).toBe(true);
  });

  it('should prevent concurrent in-flight executions for the same key', async () => {
    const payload = { orderId: 'ORD_002', amount: 200 };
    const lock1 = await manager.acquireLock('key_2', payload);
    expect(lock1.acquired).toBe(true);

    const lock2 = await manager.acquireLock('key_2', payload);
    expect(lock2.acquired).toBe(false);
    expect(lock2.inFlight).toBe(true);
  });

  it('should return cached response when key completed successfully', async () => {
    const payload = { orderId: 'ORD_003', amount: 300 };
    await manager.acquireLock('key_3', payload);

    const expectedResponse = { txnId: 'txn_123', status: 'SUCCESS' };
    await manager.saveResponse('key_3', 201, expectedResponse);

    const secondRequest = await manager.acquireLock('key_3', payload);
    expect(secondRequest.acquired).toBe(false);
    expect(secondRequest.cachedResponse).toBeDefined();
    expect(secondRequest.cachedResponse?.statusCode).toBe(201);
    expect(secondRequest.cachedResponse?.body).toEqual(expectedResponse);
  });

  it('should reject requests with matching key but mismatched payload', async () => {
    const payloadOriginal = { orderId: 'ORD_004', amount: 400 };
    await manager.acquireLock('key_4', payloadOriginal);

    const payloadModified = { orderId: 'ORD_004', amount: 999 };
    const mismatchAttempt = await manager.acquireLock('key_4', payloadModified);

    expect(mismatchAttempt.acquired).toBe(false);
    expect(mismatchAttempt.mismatch).toBe(true);
  });
});
