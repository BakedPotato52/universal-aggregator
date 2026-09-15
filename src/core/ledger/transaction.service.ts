import crypto from 'crypto';
import { PaymentStatus, TransactionRecord, PaymentRequest, BankCode } from '../types.js';
import { PrismaTransactionRepository } from '../../database/transaction.repository.js';
import { isDatabaseAvailable } from '../../database/prisma.client.js';

export class TransactionService {
  private static instance: TransactionService;
  private transactions: Map<string, TransactionRecord> = new Map();
  private orderIdIndex: Map<string, string> = new Map();
  private rrnIndex: Map<string, string> = new Map();
  private prismaRepo: PrismaTransactionRepository;

  private constructor() {
    this.prismaRepo = PrismaTransactionRepository.getInstance();
  }

  public static getInstance(): TransactionService {
    if (!TransactionService.instance) {
      TransactionService.instance = new TransactionService();
    }
    return TransactionService.instance;
  }

  public generateTransactionId(): string {
    const timestamp = Date.now().toString(36);
    const randomHex = crypto.randomBytes(6).toString('hex');
    return `txn_${timestamp}_${randomHex}`;
  }

  /**
   * Creates a new transaction and persists to PostgreSQL & memory
   */
  public createTransaction(params: {
    request: PaymentRequest;
    bankCode: BankCode;
    merchantVpa: string;
    rawUri?: string;
  }): TransactionRecord {
    const txnId = this.generateTransactionId();
    const now = new Date().toISOString();
    const expiresInSeconds = params.request.expiresInSeconds || 900;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    const fee = 0.0;
    const tax = 0.0;
    const netAmount = params.request.amount - fee - tax;

    const record: TransactionRecord = {
      id: txnId,
      merchantOrderId: params.request.merchantOrderId,
      amount: params.request.amount,
      fee,
      tax,
      netAmount,
      currency: params.request.currency || 'INR',
      status: 'INITIATED',
      method: params.request.method,
      bankCode: params.bankCode,
      merchantVpa: params.merchantVpa,
      payerVpa: params.request.payerVpa,
      customer: params.request.customer,
      webhookUrl: params.request.webhookUrl,
      rawUri: params.rawUri,
      metadata: params.request.metadata,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      history: [
        {
          status: 'INITIATED',
          timestamp: now,
          note: `Payment initiated via bank adapter [${params.bankCode}]`,
        },
      ],
    };

    // Store in memory
    this.transactions.set(txnId, record);
    this.orderIdIndex.set(params.request.merchantOrderId, txnId);

    // Asynchronously write through to PostgreSQL via Prisma
    this.prismaRepo.create(record).catch(() => {});

    return record;
  }

  /**
   * Transitions transaction state with audit logging & PostgreSQL write-through
   */
  public updateStatus(
    txnId: string,
    newStatus: PaymentStatus,
    details?: {
      bankReferenceId?: string;
      bankTransactionId?: string;
      payerVpa?: string;
      errorCode?: string;
      errorMessage?: string;
      note?: string;
      rawPayload?: any;
    }
  ): TransactionRecord {
    const record = this.transactions.get(txnId);
    if (!record) {
      throw new Error(`Transaction with ID ${txnId} not found`);
    }

    this.validateTransition(record.status, newStatus);

    const now = new Date().toISOString();
    record.status = newStatus;
    record.updatedAt = now;

    if (details?.bankReferenceId) {
      record.bankReferenceId = details.bankReferenceId;
      this.rrnIndex.set(details.bankReferenceId, txnId);
    }
    if (details?.bankTransactionId) {
      record.bankTransactionId = details.bankTransactionId;
    }
    if (details?.payerVpa) {
      record.payerVpa = details.payerVpa;
    }
    if (details?.errorCode) {
      record.errorCode = details.errorCode;
    }
    if (details?.errorMessage) {
      record.errorMessage = details.errorMessage;
    }
    if (newStatus === 'SUCCESS') {
      record.settledAt = now;
    }

    record.history.push({
      status: newStatus,
      timestamp: now,
      note: details?.note || `State updated to ${newStatus}`,
      details: details?.rawPayload,
    });

    // Write-through to PostgreSQL
    this.prismaRepo.updateStatus(txnId, newStatus, details).catch(() => {});

    return record;
  }

  public getById(txnId: string): TransactionRecord | undefined {
    return this.transactions.get(txnId);
  }

  public getByOrderId(orderId: string): TransactionRecord | undefined {
    const txnId = this.orderIdIndex.get(orderId);
    return txnId ? this.transactions.get(txnId) : undefined;
  }

  public getByRrn(rrn: string): TransactionRecord | undefined {
    const txnId = this.rrnIndex.get(rrn);
    return txnId ? this.transactions.get(txnId) : undefined;
  }

  public list(filters?: {
    status?: PaymentStatus;
    bankCode?: BankCode;
    limit?: number;
    offset?: number;
  }): { total: number; data: TransactionRecord[] } {
    let items = Array.from(this.transactions.values());

    if (filters?.status) {
      items = items.filter((t) => t.status === filters.status);
    }
    if (filters?.bankCode) {
      items = items.filter((t) => t.bankCode === filters.bankCode);
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = items.length;
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 50;
    const paginated = items.slice(offset, offset + limit);

    return { total, data: paginated };
  }

  private validateTransition(current: PaymentStatus, target: PaymentStatus): void {
    if (current === target) return;

    if (current === 'FAILED' || current === 'EXPIRED' || current === 'REFUNDED') {
      throw new Error(`Cannot transition terminal state from ${current} to ${target}`);
    }

    const validTransitions: Record<PaymentStatus, PaymentStatus[]> = {
      INITIATED: ['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'],
      PENDING: ['SUCCESS', 'FAILED', 'EXPIRED'],
      SUCCESS: ['REFUNDED', 'PARTIALLY_REFUNDED'],
      FAILED: [],
      EXPIRED: [],
      REFUNDED: [],
      PARTIALLY_REFUNDED: ['REFUNDED'],
    };

    const allowed = validTransitions[current] || [];
    if (!allowed.includes(target)) {
      throw new Error(`Invalid state transition from ${current} to ${target}`);
    }
  }

  public clear(): void {
    this.transactions.clear();
    this.orderIdIndex.clear();
    this.rrnIndex.clear();
  }
}
