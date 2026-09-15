import { describe, it, expect, beforeEach } from 'vitest';
import { TransactionService } from '../src/core/ledger/transaction.service.js';

describe('TransactionService (Ledger)', () => {
  let service: TransactionService;

  beforeEach(() => {
    service = TransactionService.getInstance();
    service.clear();
  });

  it('should create transaction record in INITIATED state', () => {
    const record = service.createTransaction({
      request: {
        merchantOrderId: 'ORD_LEDGER_01',
        amount: 750,
        currency: 'INR',
        method: 'UPI_QR',
      },
      bankCode: 'HDFC',
      merchantVpa: 'merchant@hdfcbank',
    });

    expect(record.id).toMatch(/^txn_/);
    expect(record.status).toBe('INITIATED');
    expect(record.amount).toBe(750);
    expect(record.history.length).toBe(1);
  });

  it('should enforce state transitions and maintain audit history', () => {
    const record = service.createTransaction({
      request: {
        merchantOrderId: 'ORD_LEDGER_02',
        amount: 1000,
        currency: 'INR',
        method: 'UPI_INTENT',
      },
      bankCode: 'ICICI',
      merchantVpa: 'merchant@icici',
    });

    // Valid transition: INITIATED -> PENDING
    const pendingRecord = service.updateStatus(record.id, 'PENDING', {
      bankTransactionId: 'ICICI_TXN_001',
      note: 'Intent dispatched to client',
    });
    expect(pendingRecord.status).toBe('PENDING');

    // Valid transition: PENDING -> SUCCESS
    const successRecord = service.updateStatus(record.id, 'SUCCESS', {
      bankReferenceId: 'RRN_ICICI_9988',
      payerVpa: 'customer@okhdfcbank',
    });
    expect(successRecord.status).toBe('SUCCESS');
    expect(successRecord.bankReferenceId).toBe('RRN_ICICI_9988');
    expect(successRecord.settledAt).toBeDefined();
    expect(successRecord.history.length).toBe(3);
  });

  it('should reject invalid state transitions from terminal state', () => {
    const record = service.createTransaction({
      request: {
        merchantOrderId: 'ORD_LEDGER_03',
        amount: 250,
        method: 'UPI_QR',
      },
      bankCode: 'AXIS',
      merchantVpa: 'merchant@axisbank',
    });

    service.updateStatus(record.id, 'FAILED');

    // Terminal state FAILED cannot transition to SUCCESS
    expect(() => service.updateStatus(record.id, 'SUCCESS')).toThrowError(
      /Cannot transition terminal state/
    );
  });

  it('should find transactions by MerchantOrderId and Bank RRN', () => {
    const record = service.createTransaction({
      request: {
        merchantOrderId: 'ORDER_SEARCH_100',
        amount: 300,
        method: 'UPI_QR',
      },
      bankCode: 'MOCK',
      merchantVpa: 'merchant@hdfcbank',
    });

    service.updateStatus(record.id, 'SUCCESS', {
      bankReferenceId: 'RRN_LOOKUP_555',
    });

    const byOrder = service.getByOrderId('ORDER_SEARCH_100');
    expect(byOrder?.id).toBe(record.id);

    const byRrn = service.getByRrn('RRN_LOOKUP_555');
    expect(byRrn?.id).toBe(record.id);
  });
});
