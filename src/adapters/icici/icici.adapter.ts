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

export class IciciBankAdapter implements IBankAdapter {
  public readonly bankCode: BankCode = 'ICICI';
  public readonly bankName: string = 'ICICI Bank Eazypay Direct';

  private merchantId: string;
  private subMerchantId: string;
  private aesKey: string;
  private apiBaseUrl: string;

  constructor() {
    this.merchantId = config.banks.icici.merchantId;
    this.subMerchantId = config.banks.icici.subMerchantId;
    this.aesKey = config.banks.icici.aesKey;
    this.apiBaseUrl = config.banks.icici.apiBaseUrl;
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
      tid: this.subMerchantId,
      orgid: 'ICICI',
      mode: request.method === 'UPI_INTENT' ? '04' : '02',
    });

    const iciciBankTxnId = `ICICI_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    return {
      success: true,
      bankTransactionId: iciciBankTxnId,
      rawUri,
      status: 'PENDING',
      message: 'ICICI Eazypay Direct UPI generated',
    };
  }

  public async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    payload: any
  ): Promise<BankWebhookResult> {
    let decryptedPayload = payload;

    // If ICICI sends encrypted payload in AES-256-CBC format
    if (payload.encryptedData && payload.iv) {
      try {
        const decryptedStr = BankCrypto.decryptAes256Cbc(
          payload.encryptedData,
          this.aesKey,
          payload.iv
        );
        decryptedPayload = JSON.parse(decryptedStr);
      } catch (err: any) {
        return {
          isValid: false,
          status: 'FAILED',
          errorMessage: `ICICI AES Payload decryption failed: ${err.message}`,
        };
      }
    }

    const responseCode =
      decryptedPayload.responseCode ||
      decryptedPayload.Response_Code ||
      decryptedPayload.status;
    const isSuccess = responseCode === '00' || responseCode === 'SUCCESS';
    const orderId =
      decryptedPayload.orderId ||
      decryptedPayload.Merchant_Order_Id ||
      decryptedPayload.merchantOrderId;
    const rrn =
      decryptedPayload.rrn ||
      decryptedPayload.Bank_Ref_No ||
      decryptedPayload.bankReferenceId;

    return {
      isValid: true,
      merchantOrderId: orderId,
      bankReferenceId: rrn,
      status: isSuccess ? 'SUCCESS' : 'FAILED',
      payerVpa: decryptedPayload.payerVpa || decryptedPayload.Payer_VPA,
      amount: decryptedPayload.amount ? parseFloat(decryptedPayload.amount) : undefined,
      errorCode: isSuccess ? undefined : responseCode,
      errorMessage: isSuccess
        ? undefined
        : decryptedPayload.respDesc || decryptedPayload.Status_Desc || 'Payment failed at ICICI',
      rawPayload: decryptedPayload,
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
    const refundId = `icici_ref_${Date.now()}`;
    return {
      success: true,
      refundId,
      bankReferenceId: `ICICI_REF_RRN_${Date.now()}`,
      amount,
      status: 'SUCCESS',
      rawResponse: { refundId, reason, bank: 'ICICI' },
    };
  }
}
