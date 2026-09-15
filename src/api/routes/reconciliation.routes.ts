import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BankCode } from '../../core/types.js';
import { BankMisParser } from '../../reconciliation/parser.js';
import { ReconciliationMatcher } from '../../reconciliation/matcher.js';

const ReconcileRequestSchema = z.object({
  csvContent: z.string().min(10, 'csvContent must contain CSV data'),
  bankCode: z.enum(['MOCK', 'HDFC', 'ICICI', 'AXIS']).default('MOCK'),
  autoHealPending: z.boolean().default(true),
});

export async function reconciliationRoutes(server: FastifyInstance) {
  const matcher = new ReconciliationMatcher();

  /**
   * POST /api/v1/reconciliation/reconcile-csv
   * Process Bank MIS CSV and execute 3-Way Reconciliation
   */
  server.post('/api/v1/reconciliation/reconcile-csv', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ReconcileRequestSchema.parse(req.body);

      // Parse CSV
      const misRecords = BankMisParser.parseCsv(body.csvContent, body.bankCode as BankCode);

      if (misRecords.length === 0) {
        return reply.status(400).send({
          error: 'EMPTY_MIS_FILE',
          message: 'No valid records found in the provided CSV file',
        });
      }

      // Execute 3-way matching
      const report = matcher.reconcile(misRecords, body.bankCode as BankCode, body.autoHealPending);

      return reply.send({
        success: true,
        data: report,
      });
    } catch (err: any) {
      return reply.status(400).send({
        error: 'RECONCILIATION_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * GET /api/v1/reconciliation/sample-template
   * Download sample Bank MIS CSV format
   */
  server.get('/api/v1/reconciliation/sample-template', async (_req: FastifyRequest, reply: FastifyReply) => {
    const sampleCsv = [
      'MerchantOrderId,BankReferenceId,Amount,Fee,Tax,NetSettledAmount,Status,SettlementDate,PayerVpa',
      'ORD_1001,RRN99882211,500.00,0.00,0.00,500.00,SUCCESS,2026-09-15T12:00:00Z,customer@okhdfcbank',
      'ORD_1002,RRN99882212,1250.50,0.00,0.00,1250.50,SUCCESS,2026-09-15T12:01:00Z,buyer@okaxis',
      'ORD_1003,RRN99882213,200.00,0.00,0.00,200.00,FAILED,2026-09-15T12:05:00Z,user@paytm',
    ].join('\n');

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="sample_bank_mis.csv"');
    return reply.send(sampleCsv);
  });
}
