import { BankCode, PaymentStatus } from '../core/types.js';

export type ReconMatchStatus =
  | 'MATCHED'
  | 'STATUS_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'MISSING_IN_LEDGER'
  | 'MISSING_IN_BANK';

export interface BankMisRecord {
  bankCode: BankCode;
  merchantOrderId: string;
  bankReferenceId: string; // RRN / UTR
  bankTransactionId?: string;
  amount: number;
  fee: number;
  tax: number;
  netSettledAmount: number;
  bankStatus: 'SUCCESS' | 'FAILED' | 'REFUNDED';
  settlementDate: string;
  payerVpa?: string;
  rawRow?: Record<string, string>;
}

export interface ReconItemResult {
  merchantOrderId: string;
  bankReferenceId?: string;
  internalTxnId?: string;
  matchStatus: ReconMatchStatus;
  internalStatus?: PaymentStatus;
  bankStatus?: string;
  internalAmount?: number;
  bankAmount?: number;
  amountDifference: number;
  discrepancyNote?: string;
}

export interface ReconciliationReport {
  id: string;
  bankCode: BankCode;
  statementDate: string;
  processedAt: string;
  totalRecordsInBankMis: number;
  totalMatched: number;
  totalDiscrepancies: number;
  totalSettledAmount: number;
  totalDiscrepancyAmount: number;
  items: ReconItemResult[];
}
