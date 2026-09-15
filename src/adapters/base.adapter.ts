import { BankCode, PaymentRequest, PaymentStatus, TransactionRecord } from '../core/types.js';

export interface BankPaymentResult {
  success: boolean;
  bankReferenceId?: string; // Bank RRN / UTR
  bankTransactionId?: string; // Bank internal order ID
  rawUri?: string; // For UPI (upi://pay?...)
  gatewayRedirectUrl?: string;
  status: PaymentStatus;
  message?: string;
  rawResponse?: any;
}

export interface BankWebhookResult {
  isValid: boolean;
  merchantOrderId?: string;
  bankReferenceId?: string;
  status: PaymentStatus;
  payerVpa?: string;
  amount?: number;
  errorCode?: string;
  errorMessage?: string;
  rawPayload?: any;
}

export interface BankStatusResult {
  status: PaymentStatus;
  bankReferenceId?: string;
  amount: number;
  payerVpa?: string;
  settledAt?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: any;
}

export interface BankRefundResult {
  success: boolean;
  refundId: string;
  bankReferenceId?: string;
  amount: number;
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  rawResponse?: any;
}

export interface IBankAdapter {
  readonly bankCode: BankCode;
  readonly bankName: string;

  initiatePayment(request: PaymentRequest, txn: TransactionRecord): Promise<BankPaymentResult>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, payload: any): Promise<BankWebhookResult>;
  checkStatus(txn: TransactionRecord): Promise<BankStatusResult>;
  refundPayment(txn: TransactionRecord, amount: number, reason: string): Promise<BankRefundResult>;
}
