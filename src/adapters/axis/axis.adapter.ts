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

export class AxisBankAdapter implements IBankAdapter {
  public readonly bankCode: BankCode = 'AXIS';
  public readonly bankName: string = 'Axis Bank Direct Gateway';

  private merchantId: string;
  private checksumKey: string;
  private apiBaseUrl: string;

  constructor() {
    this.merchantId = config.banks.axis.merchantId;
    this.checksumKey = config.banks.axis.checksumKey;
    this.apiBaseUrl = config.banks.axis.apiBaseUrl;
  }

  public async initiatePayment(
    request: PaymentRequest,
    txn: TransactionRecord
  ): Promise<BankPaymentResult> {
    const merchantVpa = txn.merchantVpa || config.merchant.defaultVpa;

    const rawUri = UpiUriBuilder.build({
      pa: merchantVpa,
      pn: config.merchant.name,
      mc: config.merchant.defaultMcc,
      tr: txn.id,
      tn: request.description || `Order #${request.merchantOrderId}`,
      am: request.amount,
      cu: 'INR',
      orgid: 'AXIS',
      mode: request.method === 'UPI_INTENT' ? '04' : '02',
    });

    const axisBankTxnId = `AXIS_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    return {
      success: true,
      bankTransactionId: axisBankTxnId,
      rawUri,
      status: 'PENDING',
      message: 'Axis Bank Direct UPI generated',
    };
  }

  public async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    payload: any
  ): Promise<BankWebhookResult> {
    const checksum = (headers['x-axis-checksum'] as string) || payload.checksum;

    const orderId = payload.orderId || payload.merchantRefNo || payload.merchantOrderId;
    const amount = payload.amount || payload.txnAmount;
    const statusCode = payload.statusCode || payload.status;
    const rrn = payload.rrn || payload.bankRefNo;

    if (checksum && this.checksumKey) {
      const dataToSign = `${this.merchantId}|${orderId}|${amount}|${statusCode}|${rrn}`;
      const isValid = BankCrypto.verifyHmacSha256(dataToSign, this.checksumKey, checksum);
      if (!isValid) {
        return {
          isValid: false,
          status: 'FAILED',
          errorMessage: 'Axis Bank checksum verification failed',
        };
      }
    }

    const isSuccess = statusCode === '00' || statusCode === 'SUCCESS';

    return {
      isValid: true,
      merchantOrderId: orderId,
      bankReferenceId: rrn,
      status: isSuccess ? 'SUCCESS' : 'FAILED',
      payerVpa: payload.payerVpa || payload.customerVpa,
      amount: amount ? parseFloat(amount) : undefined,
      errorCode: isSuccess ? undefined : statusCode,
      errorMessage: isSuccess ? undefined : payload.statusDesc || 'Payment failed at Axis Bank',
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
    const refundId = `axis_ref_${Date.now()}`;
    return {
      success: true,
      refundId,
      bankReferenceId: `AXIS_RRN_${Date.now()}`,
      amount,
      status: 'SUCCESS',
      rawResponse: { refundId, reason, bank: 'AXIS' },
    };
  }
}
