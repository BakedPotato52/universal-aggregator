import { BankCode } from '../core/types.js';
import { BankAdapterRegistry } from '../adapters/index.js';
import { TransactionService } from '../core/ledger/transaction.service.js';
import { OutboxService } from '../core/outbox/outbox.service.js';
import { config } from '../config/index.js';

export interface BankCallbackProcessResult {
  success: boolean;
  transactionId?: string;
  merchantOrderId?: string;
  status?: string;
  bankReferenceId?: string;
  error?: string;
  responsePayload: any;
}

export class BankCallbackHandler {
  private static instance: BankCallbackHandler;
  private txnService: TransactionService;
  private outbox: OutboxService;

  private constructor() {
    this.txnService = TransactionService.getInstance();
    this.outbox = OutboxService.getInstance();
  }

  public static getInstance(): BankCallbackHandler {
    if (!BankCallbackHandler.instance) {
      BankCallbackHandler.instance = new BankCallbackHandler();
    }
    return BankCallbackHandler.instance;
  }

  /**
   * Process incoming S2S callback from an acquiring bank
   */
  public async handleCallback(
    bankCode: BankCode,
    headers: Record<string, string | string[] | undefined>,
    payload: any
  ): Promise<BankCallbackProcessResult> {
    try {
      const adapter = BankAdapterRegistry.get(bankCode);
      const verifyResult = await adapter.verifyWebhook(headers, payload);

      if (!verifyResult.isValid) {
        return {
          success: false,
          error: verifyResult.errorMessage || 'Bank webhook signature verification failed',
          responsePayload: { status: 'ERROR', message: 'Signature verification failed' },
        };
      }

      // Look up transaction by merchantOrderId or bankReferenceId
      let txn = verifyResult.merchantOrderId
        ? this.txnService.getByOrderId(verifyResult.merchantOrderId)
        : undefined;

      if (!txn && verifyResult.bankReferenceId) {
        txn = this.txnService.getByRrn(verifyResult.bankReferenceId);
      }

      if (!txn) {
        // Log unmatched webhook for manual reconciliation
        return {
          success: false,
          error: `No matching transaction found for Order ID [${verifyResult.merchantOrderId}] or RRN [${verifyResult.bankReferenceId}]`,
          responsePayload: { status: 'ERROR', message: 'Transaction not found' },
        };
      }

      // Update Ledger Status
      const updatedTxn = this.txnService.updateStatus(txn.id, verifyResult.status, {
        bankReferenceId: verifyResult.bankReferenceId,
        payerVpa: verifyResult.payerVpa,
        errorCode: verifyResult.errorCode,
        errorMessage: verifyResult.errorMessage,
        note: `Updated via S2S bank webhook callback [${bankCode}]`,
        rawPayload: verifyResult.rawPayload,
      });

      // Enqueue Outbound Merchant Webhook if configured
      if (updatedTxn.webhookUrl) {
        const eventType =
          updatedTxn.status === 'SUCCESS' ? 'payment.success' : 'payment.failed';

        this.outbox.enqueue({
          eventType,
          targetUrl: updatedTxn.webhookUrl,
          secretKey: config.webhooks.merchantSecret,
          maxAttempts: config.webhooks.maxRetries,
          payload: {
            event: eventType,
            data: {
              id: updatedTxn.id,
              merchantOrderId: updatedTxn.merchantOrderId,
              amount: updatedTxn.amount,
              currency: updatedTxn.currency,
              status: updatedTxn.status,
              bankCode: updatedTxn.bankCode,
              bankReferenceId: updatedTxn.bankReferenceId,
              payerVpa: updatedTxn.payerVpa,
              settledAt: updatedTxn.settledAt,
              createdAt: updatedTxn.createdAt,
            },
          },
        });
      }

      return {
        success: true,
        transactionId: updatedTxn.id,
        merchantOrderId: updatedTxn.merchantOrderId,
        status: updatedTxn.status,
        bankReferenceId: updatedTxn.bankReferenceId,
        responsePayload: {
          status: 'SUCCESS',
          message: 'Callback acknowledged',
          txnId: updatedTxn.id,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        responsePayload: { status: 'ERROR', message: err.message },
      };
    }
  }
}
