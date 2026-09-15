import crypto from 'crypto';
import { BankCode } from '../core/types.js';
import { TransactionService } from '../core/ledger/transaction.service.js';
import { BankMisRecord, ReconciliationReport, ReconItemResult } from './types.js';

export class ReconciliationMatcher {
  private txnService: TransactionService;

  constructor() {
    this.txnService = TransactionService.getInstance();
  }

  /**
   * Runs 3-Way Automated Reconciliation against Internal Ledger
   * @param records Parsed bank MIS records
   * @param bankCode Bank identifier
   * @param autoHealPending If true, automatically updates internal PENDING transactions to SUCCESS when confirmed by bank MIS
   */
  public reconcile(
    records: BankMisRecord[],
    bankCode: BankCode = 'MOCK',
    autoHealPending = true
  ): ReconciliationReport {
    const reportId = `recon_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const items: ReconItemResult[] = [];
    let totalMatched = 0;
    let totalDiscrepancies = 0;
    let totalSettledAmount = 0;
    let totalDiscrepancyAmount = 0;

    for (const bankRec of records) {
      totalSettledAmount += bankRec.netSettledAmount;

      // Find internal transaction
      let txn = this.txnService.getByOrderId(bankRec.merchantOrderId);
      if (!txn && bankRec.bankReferenceId) {
        txn = this.txnService.getByRrn(bankRec.bankReferenceId);
      }

      if (!txn) {
        totalDiscrepancies++;
        totalDiscrepancyAmount += bankRec.amount;
        items.push({
          merchantOrderId: bankRec.merchantOrderId,
          bankReferenceId: bankRec.bankReferenceId,
          matchStatus: 'MISSING_IN_LEDGER',
          bankStatus: bankRec.bankStatus,
          bankAmount: bankRec.amount,
          amountDifference: bankRec.amount,
          discrepancyNote: 'Unclaimed bank credit: Bank settled funds but no internal order found',
        });
        continue;
      }

      // Check amount difference
      const amountDiff = Math.abs(txn.amount - bankRec.amount);
      const isAmountMatching = amountDiff < 0.01;

      if (!isAmountMatching) {
        totalDiscrepancies++;
        totalDiscrepancyAmount += amountDiff;
        items.push({
          merchantOrderId: txn.merchantOrderId,
          internalTxnId: txn.id,
          bankReferenceId: bankRec.bankReferenceId,
          matchStatus: 'AMOUNT_MISMATCH',
          internalStatus: txn.status,
          bankStatus: bankRec.bankStatus,
          internalAmount: txn.amount,
          bankAmount: bankRec.amount,
          amountDifference: amountDiff,
          discrepancyNote: `Amount mismatch: Internal [₹${txn.amount}] vs Bank [₹${bankRec.amount}]`,
        });
        continue;
      }

      // Check status matching
      if (txn.status === 'SUCCESS' && bankRec.bankStatus === 'SUCCESS') {
        totalMatched++;
        items.push({
          merchantOrderId: txn.merchantOrderId,
          internalTxnId: txn.id,
          bankReferenceId: bankRec.bankReferenceId,
          matchStatus: 'MATCHED',
          internalStatus: txn.status,
          bankStatus: bankRec.bankStatus,
          internalAmount: txn.amount,
          bankAmount: bankRec.amount,
          amountDifference: 0,
        });
      } else if (txn.status === 'PENDING' && bankRec.bankStatus === 'SUCCESS') {
        // Customer paid, bank settled, but webhook had failed or dropped
        if (autoHealPending) {
          this.txnService.updateStatus(txn.id, 'SUCCESS', {
            bankReferenceId: bankRec.bankReferenceId,
            note: 'Auto-reconciled to SUCCESS via Bank MIS Settlement file',
          });
        }
        totalMatched++;
        items.push({
          merchantOrderId: txn.merchantOrderId,
          internalTxnId: txn.id,
          bankReferenceId: bankRec.bankReferenceId,
          matchStatus: 'MATCHED',
          internalStatus: 'SUCCESS',
          bankStatus: bankRec.bankStatus,
          internalAmount: txn.amount,
          bankAmount: bankRec.amount,
          amountDifference: 0,
          discrepancyNote: 'Auto-healed: Status resolved from PENDING to SUCCESS via bank MIS settlement',
        });
      } else {
        totalDiscrepancies++;
        totalDiscrepancyAmount += txn.amount;
        items.push({
          merchantOrderId: txn.merchantOrderId,
          internalTxnId: txn.id,
          bankReferenceId: bankRec.bankReferenceId,
          matchStatus: 'STATUS_MISMATCH',
          internalStatus: txn.status,
          bankStatus: bankRec.bankStatus,
          internalAmount: txn.amount,
          bankAmount: bankRec.amount,
          amountDifference: txn.amount,
          discrepancyNote: `Status conflict: Internal is [${txn.status}] while Bank settled as [${bankRec.bankStatus}]`,
        });
      }
    }

    return {
      id: reportId,
      bankCode,
      statementDate: records[0]?.settlementDate || new Date().toISOString(),
      processedAt: new Date().toISOString(),
      totalRecordsInBankMis: records.length,
      totalMatched,
      totalDiscrepancies,
      totalSettledAmount,
      totalDiscrepancyAmount,
      items,
    };
  }
}
