import crypto from 'crypto';
import { BankCrypto } from '../../upi/crypto.js';

export interface OutboxEvent {
  id: string;
  eventType: 'payment.success' | 'payment.failed' | 'payment.refunded' | 'payment.expired';
  targetUrl: string;
  payload: any;
  secretKey: string;
  attempts: number;
  maxAttempts: number;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  lastError?: string;
  nextRetryAt: number;
  createdAt: string;
  deliveredAt?: string;
}

export class OutboxService {
  private static instance: OutboxService;
  private queue: Map<string, OutboxEvent> = new Map();
  private isProcessing = false;
  private timer: NodeJS.Timeout | null = null;

  private constructor() {
    this.startWorker();
  }

  public static getInstance(): OutboxService {
    if (!OutboxService.instance) {
      OutboxService.instance = new OutboxService();
    }
    return OutboxService.instance;
  }

  /**
   * Enqueues a webhook event for asynchronous reliable delivery
   */
  public enqueue(params: {
    eventType: 'payment.success' | 'payment.failed' | 'payment.refunded' | 'payment.expired';
    targetUrl: string;
    payload: any;
    secretKey: string;
    maxAttempts?: number;
  }): OutboxEvent {
    const id = `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    const event: OutboxEvent = {
      id,
      eventType: params.eventType,
      targetUrl: params.targetUrl,
      payload: params.payload,
      secretKey: params.secretKey,
      attempts: 0,
      maxAttempts: params.maxAttempts || 5,
      status: 'PENDING',
      nextRetryAt: Date.now(),
      createdAt: now,
    };

    this.queue.set(id, event);
    return event;
  }

  /**
   * Worker loop to process pending outbox events
   */
  public async processPendingEvents(): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (this.isProcessing) return { processed: 0, succeeded: 0, failed: 0 };
    this.isProcessing = true;

    const now = Date.now();
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const [id, event] of this.queue.entries()) {
      if (event.status === 'PENDING' && event.nextRetryAt <= now) {
        processed++;
        event.attempts++;

        try {
          const signature = BankCrypto.generateHmacSha256(event.payload, event.secretKey);
          const response = await fetch(event.targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Event': event.eventType,
              'X-Webhook-Signature': signature,
              'X-Webhook-Id': event.id,
              'X-Webhook-Timestamp': now.toString(),
            },
            body: JSON.stringify(event.payload),
            signal: AbortSignal.timeout(5000), // 5s timeout
          });

          if (response.ok) {
            event.status = 'DELIVERED';
            event.deliveredAt = new Date().toISOString();
            succeeded++;
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        } catch (err: any) {
          event.lastError = err.message || 'Network error';
          if (event.attempts >= event.maxAttempts) {
            event.status = 'FAILED';
            failed++;
          } else {
            // Exponential backoff: 2s, 4s, 8s, 16s...
            const backoffMs = Math.pow(2, event.attempts) * 1000;
            event.nextRetryAt = Date.now() + backoffMs;
          }
        }
      }
    }

    this.isProcessing = false;
    return { processed, succeeded, failed };
  }

  private startWorker(): void {
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.processPendingEvents().catch(() => {});
      }, 2000);
      this.timer.unref();
    }
  }

  public getEvents(): OutboxEvent[] {
    return Array.from(this.queue.values());
  }

  public clear(): void {
    this.queue.clear();
  }
}
