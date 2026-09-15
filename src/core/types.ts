export type PaymentStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type PaymentMethod =
  | 'UPI_QR'
  | 'UPI_INTENT'
  | 'UPI_COLLECT'
  | 'NETBANKING'
  | 'CARD';

export type BankCode = 'MOCK' | 'HDFC' | 'ICICI' | 'AXIS';

export interface CustomerDetails {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  vpa?: string;
}

export interface PaymentRequest {
  merchantOrderId: string;
  amount: number;
  currency?: 'INR';
  description?: string;
  method: PaymentMethod;
  customer?: CustomerDetails;
  payerVpa?: string; // For UPI_COLLECT
  preferredBank?: BankCode;
  webhookUrl?: string;
  metadata?: Record<string, any>;
  expiresInSeconds?: number;
}

export interface TransactionRecord {
  id: string; // Internal unique Transaction ID (e.g. txn_...)
  merchantOrderId: string;
  bankReferenceId?: string; // Bank RRN (Retrieval Reference Number) / UTR
  bankTransactionId?: string; // Bank internal order ID / gateway ref
  amount: number;
  fee: number;
  tax: number;
  netAmount: number;
  currency: 'INR';
  status: PaymentStatus;
  method: PaymentMethod;
  bankCode: BankCode;
  merchantVpa: string;
  payerVpa?: string;
  customer?: CustomerDetails;
  webhookUrl?: string;
  rawUri?: string;
  metadata?: Record<string, any>;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
  expiresAt: string;
  history: Array<{
    status: PaymentStatus;
    timestamp: string;
    note?: string;
    details?: any;
  }>;
}

export interface BankHealthMetrics {
  bankCode: BankCode;
  isHealthy: boolean;
  successRate24h: number; // percentage (0-100)
  avgLatencyMs: number;
  activeIncidents: number;
}

export interface RoutingDecision {
  selectedBank: BankCode;
  reason: string;
  fallbackBanks: BankCode[];
}
