import {
  BankCode,
  PaymentRequest,
  TransactionRecord,
} from '../../core/types.js';
import {
  IBankAdapter,
  BankPaymentResult,
  BankWebhookResult,
  BankStatusResult,
  BankRefundResult,
} from '../base.adapter.js';
import { UpiUriBuilder } from '../../upi/uri-builder.js';
import { BankCrypto } from '../../upi/crypto.js';
import { config } from '../../config/index.js';

export class MockBankAdapter implements IBankAdapter {
  public readonly bankCode: BankCode = 'MOCK';
  public readonly bankName: string = 'Universal Mock Bank Sandbox';
  private mockSecretKey = 'mock_bank_secret_signing_key_12345';

  public async initiatePayment(
    request: PaymentRequest,
    txn: TransactionRecord
  ): Promise<BankPaymentResult> {
    const rawUri = UpiUriBuilder.build({
      pa: txn.merchantVpa || config.merchant.defaultVpa,
      pn: config.merchant.name,
      mc: config.merchant.defaultMcc,
      tr: txn.id,
      tn: request.description || `Order #${request.merchantOrderId}`,
      am: request.amount,
      cu: 'INR',
      mode: request.method === 'UPI_INTENT' ? '04' : '02',
    });

    const mockBankTxnId = `mb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    return {
      success: true,
      bankTransactionId: mockBankTxnId,
      rawUri,
      status: 'PENDING',
      message: 'Mock UPI Intent/QR successfully generated',
    };
  }

  public async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    payload: any
  ): Promise<BankWebhookResult> {
    const signature = (headers['x-bank-signature'] || headers['x-mock-signature']) as string;
    
    // Validate signature if present
    if (signature) {
      const isValid = BankCrypto.verifyHmacSha256(payload, this.mockSecretKey, signature);
      if (!isValid) {
        return {
          isValid: false,
          status: 'FAILED',
          errorMessage: 'Invalid Mock Bank signature',
        };
      }
    }

    const isSuccess = payload.status === 'SUCCESS' || payload.responseCode === '00';
    return {
      isValid: true,
      merchantOrderId: payload.orderId || payload.merchantOrderId,
      bankReferenceId: payload.rrn || payload.bankReferenceId || `RRN${Date.now()}`,
      status: isSuccess ? 'SUCCESS' : 'FAILED',
      payerVpa: payload.payerVpa || 'customer@okhdfcbank',
      amount: payload.amount ? parseFloat(payload.amount) : undefined,
      errorCode: isSuccess ? undefined : payload.responseCode || 'ERR_MOCK_FAILURE',
      errorMessage: isSuccess ? undefined : payload.message || 'Payment failed',
      rawPayload: payload,
    };
  }

  public async checkStatus(txn: TransactionRecord): Promise<BankStatusResult> {
    return {
      status: txn.status,
      bankReferenceId: txn.bankReferenceId,
      amount: txn.amount,
      payerVpa: txn.payerVpa,
      settledAt: txn.settledAt,
    };
  }

  public async refundPayment(
    txn: TransactionRecord,
    amount: number,
    reason: string
  ): Promise<BankRefundResult> {
    const refundId = `ref_mock_${Date.now()}`;
    return {
      success: true,
      refundId,
      bankReferenceId: `REF_RRN_${Date.now()}`,
      amount,
      status: 'SUCCESS',
      rawResponse: { refundId, reason, settled: true },
    };
  }

  /**
   * Helper for tests / UI to sign a mock bank webhook
   */
  public signMockWebhook(payload: any): string {
    return BankCrypto.generateHmacSha256(payload, this.mockSecretKey);
  }
}
