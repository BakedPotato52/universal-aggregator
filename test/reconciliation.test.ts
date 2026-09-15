import { describe, it, expect, beforeEach } from 'vitest';
import { BankMisParser } from '../src/reconciliation/parser.js';
import { ReconciliationMatcher } from '../src/reconciliation/matcher.js';
import { TransactionService } from '../src/core/ledger/transaction.service.js';

describe('3-Way Automated Reconciliation', () => {
  let txnService: TransactionService;
  let matcher: ReconciliationMatcher;

  beforeEach(() => {
    txnService = TransactionService.getInstance();
    txnService.clear();
    matcher = new ReconciliationMatcher();
  });

  it('should parse standard Bank MIS settlement CSV files accurately', () => {
    const csvContent = `MerchantOrderId,BankReferenceId,Amount,Fee,Tax,NetSettledAmount,Status,SettlementDate
ORD_101,RRN_001,500.00,0.00,0.00,500.00,SUCCESS,2026-09-15
ORD_102,RRN_002,1200.50,12.00,2.16,1186.34,SUCCESS,2026-09-15
ORD_103,RRN_003,300.00,0.00,0.00,300.00,FAILED,2026-09-15`;

    const records = BankMisParser.parseCsv(csvContent, 'HDFC');
    expect(records.length).toBe(3);
    expect(records[0].merchantOrderId).toBe('ORD_101');
    expect(records[0].amount).toBe(500);
    expect(records[1].netSettledAmount).toBe(1186.34);
    expect(records[2].bankStatus).toBe('FAILED');
  });

  it('should reconcile matching transactions, detect discrepancies and auto-heal pending status', () => {
    // 1. Transaction 1: Pre-existing SUCCESS in ledger matching bank MIS
    const txn1 = txnService.createTransaction({
      request: { merchantOrderId: 'ORD_MATCH_01', amount: 500, method: 'UPI_QR' },
      bankCode: 'HDFC',
      merchantVpa: 'merchant@hdfcbank',
    });
    txnService.updateStatus(txn1.id, 'SUCCESS', { bankReferenceId: 'RRN_MATCH_01' });

    // 2. Transaction 2: PENDING in ledger (webhook dropped), but Bank confirmed SUCCESS
    const txn2 = txnService.createTransaction({
      request: { merchantOrderId: 'ORD_HEAL_02', amount: 750, method: 'UPI_INTENT' },
      bankCode: 'ICICI',
      merchantVpa: 'merchant@icici',
    });
    txnService.updateStatus(txn2.id, 'PENDING');

    // 3. Transaction 3: AMOUNT MISMATCH (Customer paid ₹100 instead of ₹200)
    const txn3 = txnService.createTransaction({
      request: { merchantOrderId: 'ORD_MISMATCH_03', amount: 200, method: 'UPI_QR' },
      bankCode: 'AXIS',
      merchantVpa: 'merchant@axisbank',
    });
    txnService.updateStatus(txn3.id, 'SUCCESS');

    // Bank MIS Settlement Dump
    const csvContent = `MerchantOrderId,BankReferenceId,Amount,Fee,Tax,NetSettledAmount,Status,SettlementDate
ORD_MATCH_01,RRN_MATCH_01,500.00,0.00,0.00,500.00,SUCCESS,2026-09-15
ORD_HEAL_02,RRN_HEAL_02,750.00,0.00,0.00,750.00,SUCCESS,2026-09-15
ORD_MISMATCH_03,RRN_MISMATCH_03,100.00,0.00,0.00,100.00,SUCCESS,2026-09-15
ORD_UNCLAIMED_04,RRN_UNCLAIMED_04,300.00,0.00,0.00,300.00,SUCCESS,2026-09-15`;

    const records = BankMisParser.parseCsv(csvContent, 'MOCK');
    const report = matcher.reconcile(records, 'MOCK', true);

    expect(report.totalRecordsInBankMis).toBe(4);
    expect(report.totalMatched).toBe(2); // txn1 and auto-healed txn2
    expect(report.totalDiscrepancies).toBe(2); // txn3 (amount mismatch) and unclaimed txn4

    // Verify auto-heal updated txn2 in ledger
    const healedTxn2 = txnService.getById(txn2.id);
    expect(healedTxn2?.status).toBe('SUCCESS');
    expect(healedTxn2?.bankReferenceId).toBe('RRN_HEAL_02');
  });
});
