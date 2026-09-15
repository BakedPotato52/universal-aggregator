import { TransactionRecord, PaymentStatus, BankCode, PaymentMethod } from '../core/types.js';
import { getPrismaClient, isDatabaseAvailable } from './prisma.client.js';

export class PrismaTransactionRepository {
  private static instance: PrismaTransactionRepository;

  private constructor() {}

  public static getInstance(): PrismaTransactionRepository {
    if (!PrismaTransactionRepository.instance) {
      PrismaTransactionRepository.instance = new PrismaTransactionRepository();
    }
    return PrismaTransactionRepository.instance;
  }

  /**
   * Persist a new transaction into PostgreSQL
   */
  public async create(record: TransactionRecord): Promise<boolean> {
    const isUp = await isDatabaseAvailable();
    if (!isUp) return false;

    try {
      const prisma = getPrismaClient();
      await prisma.transaction.create({
        data: {
          id: record.id,
          merchantOrderId: record.merchantOrderId,
          bankReferenceId: record.bankReferenceId,
          bankTransactionId: record.bankTransactionId,
          amount: record.amount,
          fee: record.fee,
          tax: record.tax,
          netAmount: record.netAmount,
          currency: record.currency,
          status: record.status,
          method: record.method,
          bankCode: record.bankCode,
          merchantVpa: record.merchantVpa,
          payerVpa: record.payerVpa,
          customerName: record.customer?.name,
          customerEmail: record.customer?.email,
          customerPhone: record.customer?.phone,
          webhookUrl: record.webhookUrl,
          rawUri: record.rawUri,
          metadata: record.metadata,
          errorCode: record.errorCode,
          errorMessage: record.errorMessage,
          settledAt: record.settledAt ? new Date(record.settledAt) : null,
          expiresAt: new Date(record.expiresAt),
          history: {
            create: {
              status: record.status,
              note: record.history[0]?.note || 'Initiated',
              rawPayload: record.history[0]?.details || null,
            },
          },
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Atomically update status and insert audit history row in PostgreSQL
   */
  public async updateStatus(
    id: string,
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
  ): Promise<boolean> {
    const isUp = await isDatabaseAvailable();
    if (!isUp) return false;

    try {
      const prisma = getPrismaClient();
      await prisma.$transaction(async (tx) => {
        await tx.transaction.update({
          where: { id },
          data: {
            status: newStatus,
            bankReferenceId: details?.bankReferenceId,
            bankTransactionId: details?.bankTransactionId,
            payerVpa: details?.payerVpa,
            errorCode: details?.errorCode,
            errorMessage: details?.errorMessage,
            settledAt: newStatus === 'SUCCESS' ? new Date() : undefined,
          },
        });

        await tx.transactionHistory.create({
          data: {
            transactionId: id,
            status: newStatus,
            note: details?.note || `Status updated to ${newStatus}`,
            rawPayload: details?.rawPayload || null,
          },
        });
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find transaction by internal ID
   */
  public async findById(id: string): Promise<TransactionRecord | null> {
    const isUp = await isDatabaseAvailable();
    if (!isUp) return null;

    try {
      const prisma = getPrismaClient();
      const row = await prisma.transaction.findUnique({
        where: { id },
        include: { history: { orderBy: { timestamp: 'asc' } } },
      });
      return row ? this.mapRowToRecord(row) : null;
    } catch {
      return null;
    }
  }

  /**
   * Find transaction by Merchant Order ID
   */
  public async findByOrderId(merchantOrderId: string): Promise<TransactionRecord | null> {
    const isUp = await isDatabaseAvailable();
    if (!isUp) return null;

    try {
      const prisma = getPrismaClient();
      const row = await prisma.transaction.findUnique({
        where: { merchantOrderId },
        include: { history: { orderBy: { timestamp: 'asc' } } },
      });
      return row ? this.mapRowToRecord(row) : null;
    } catch {
      return null;
    }
  }

  /**
   * Find transaction by Bank RRN / UTR
   */
  public async findByRrn(bankReferenceId: string): Promise<TransactionRecord | null> {
    const isUp = await isDatabaseAvailable();
    if (!isUp) return null;

    try {
      const prisma = getPrismaClient();
      const row = await prisma.transaction.findFirst({
        where: { bankReferenceId },
        include: { history: { orderBy: { timestamp: 'asc' } } },
      });
      return row ? this.mapRowToRecord(row) : null;
    } catch {
      return null;
    }
  }

  private mapRowToRecord(row: any): TransactionRecord {
    return {
      id: row.id,
      merchantOrderId: row.merchantOrderId,
      bankReferenceId: row.bankReferenceId || undefined,
      bankTransactionId: row.bankTransactionId || undefined,
      amount: row.amount,
      fee: row.fee,
      tax: row.tax,
      netAmount: row.netAmount,
      currency: 'INR',
      status: row.status as PaymentStatus,
      method: row.method as PaymentMethod,
      bankCode: row.bankCode as BankCode,
      merchantVpa: row.merchantVpa,
      payerVpa: row.payerVpa || undefined,
      customer: {
        name: row.customerName || undefined,
        email: row.customerEmail || undefined,
        phone: row.customerPhone || undefined,
      },
      webhookUrl: row.webhookUrl || undefined,
      rawUri: row.rawUri || undefined,
      metadata: row.metadata || undefined,
      errorCode: row.errorCode || undefined,
      errorMessage: row.errorMessage || undefined,
      settledAt: row.settledAt?.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      history: (row.history || []).map((h: any) => ({
        status: h.status as PaymentStatus,
        timestamp: h.timestamp.toISOString(),
        note: h.note || undefined,
        details: h.rawPayload || undefined,
      })),
    };
  }
}
