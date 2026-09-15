import { OutboxService, OutboxEvent } from '../core/outbox/outbox.service.js';
import { config } from '../config/index.js';

export class MerchantNotifier {
  private static instance: MerchantNotifier;
  private outbox: OutboxService;

  private constructor() {
    this.outbox = OutboxService.getInstance();
  }

  public static getInstance(): MerchantNotifier {
    if (!MerchantNotifier.instance) {
      MerchantNotifier.instance = new MerchantNotifier();
    }
    return MerchantNotifier.instance;
  }

  /**
   * Dispatches a signed event to the merchant
   */
  public notify(
    eventType: 'payment.success' | 'payment.failed' | 'payment.refunded' | 'payment.expired',
    targetUrl: string,
    payload: any,
    secretKey = config.webhooks.merchantSecret
  ): OutboxEvent {
    return this.outbox.enqueue({
      eventType,
      targetUrl,
      payload,
      secretKey,
      maxAttempts: config.webhooks.maxRetries,
    });
  }

  /**
   * Retrieves all event delivery logs
   */
  public getDeliveryLogs(): OutboxEvent[] {
    return this.outbox.getEvents();
  }
}
