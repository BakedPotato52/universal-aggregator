import { parse } from 'csv-parse/sync';
import { BankCode } from '../core/types.js';
import { BankMisRecord } from './types.js';

export class BankMisParser {
  /**
   * Parses CSV string from bank settlement MIS dumps
   * Handles column name aliases across HDFC, ICICI, Axis, and standard formats.
   */
  public static parseCsv(csvContent: string, bankCode: BankCode = 'MOCK'): BankMisRecord[] {
    if (!csvContent || csvContent.trim().length === 0) {
      return [];
    }

    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];

    return records.map((row) => this.mapRowToMisRecord(row, bankCode));
  }

  private static mapRowToMisRecord(row: Record<string, string>, defaultBank: BankCode): BankMisRecord {
    // Standardize column key lookups (case-insensitive)
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      normalized[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = v;
    }

    const merchantOrderId =
      normalized['merchantorderid'] ||
      normalized['orderid'] ||
      normalized['merchantrefno'] ||
      normalized['orderref'] ||
      normalized['txnid'] ||
      'UNKNOWN_ORDER';

    const bankReferenceId =
      normalized['bankreferenceid'] ||
      normalized['rrn'] ||
      normalized['utr'] ||
      normalized['bankrefno'] ||
      normalized['retrievalrefno'] ||
      '';

    const bankTransactionId =
      normalized['banktransactionid'] ||
      normalized['banktxnid'] ||
      normalized['gatewaytxnid'] ||
      undefined;

    const amountStr =
      normalized['amount'] ||
      normalized['txnamount'] ||
      normalized['grossamount'] ||
      normalized['orderamount'] ||
      '0';

    const feeStr =
      normalized['fee'] ||
      normalized['mdr'] ||
      normalized['commission'] ||
      normalized['charges'] ||
      '0';

    const taxStr = normalized['tax'] || normalized['gst'] || '0';

    const netSettledStr =
      normalized['netsettledamount'] ||
      normalized['netamount'] ||
      normalized['settlementamount'] ||
      amountStr;

    const statusRaw = (
      normalized['status'] ||
      normalized['txnstatus'] ||
      normalized['responsecode'] ||
      'SUCCESS'
    ).toUpperCase();

    let bankStatus: 'SUCCESS' | 'FAILED' | 'REFUNDED' = 'SUCCESS';
    if (statusRaw.includes('FAIL') || statusRaw === '01' || statusRaw === 'FAILURE') {
      bankStatus = 'FAILED';
    } else if (statusRaw.includes('REFUND')) {
      bankStatus = 'REFUNDED';
    }

    const settlementDate =
      normalized['settlementdate'] ||
      normalized['txndate'] ||
      normalized['date'] ||
      new Date().toISOString();

    const payerVpa =
      normalized['payervpa'] ||
      normalized['customervpa'] ||
      normalized['vpa'] ||
      undefined;

    const amount = parseFloat(amountStr) || 0;
    const fee = parseFloat(feeStr) || 0;
    const tax = parseFloat(taxStr) || 0;
    const netSettledAmount = parseFloat(netSettledStr) || (amount - fee - tax);

    return {
      bankCode: defaultBank,
      merchantOrderId,
      bankReferenceId,
      bankTransactionId,
      amount,
      fee,
      tax,
      netSettledAmount,
      bankStatus,
      settlementDate,
      payerVpa,
      rawRow: row,
    };
  }
}
