import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { TransactionService } from '../../core/ledger/transaction.service.js';
import { BankCallbackHandler } from '../../webhooks/bank-callback.handler.js';
import { MockBankAdapter } from '../../adapters/mock/mock.adapter.js';
import { SmartRouter } from '../../core/routing/router.js';
import { config } from '../../config/index.js';
import { BankCode } from '../../core/types.js';

const SimulatePaymentSchema = z.object({
  transactionId: z.string().optional(),
  merchantOrderId: z.string().optional(),
  payerVpa: z.string().default('customer@okhdfcbank'),
  simulateFailure: z.boolean().default(false),
  failureReason: z.string().optional(),
});

export async function simulatorRoutes(server: FastifyInstance) {
  const txnService = TransactionService.getInstance();
  const callbackHandler = BankCallbackHandler.getInstance();
  const mockAdapter = new MockBankAdapter();
  const router = new SmartRouter(config.routing.defaultBank as BankCode);

  /**
   * POST /api/v1/simulator/pay
   * Simulates customer opening UPI app, entering PIN, and bank firing S2S Webhook
   */
  server.post('/api/v1/simulator/pay', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = SimulatePaymentSchema.parse(req.body);

      let txn = body.transactionId ? txnService.getById(body.transactionId) : undefined;
      if (!txn && body.merchantOrderId) {
        txn = txnService.getByOrderId(body.merchantOrderId);
      }

      if (!txn) {
        return reply.status(404).send({
          error: 'TRANSACTION_NOT_FOUND',
          message: 'Could not find transaction to simulate payment for',
        });
      }

      const isSuccess = !body.simulateFailure;
      const rrn = `RRN${Date.now()}`;

      // Construct Mock Bank Callback Payload
      const bankPayload = {
        orderId: txn.merchantOrderId,
        amount: txn.amount.toFixed(2),
        status: isSuccess ? 'SUCCESS' : 'FAILED',
        responseCode: isSuccess ? '00' : 'U30',
        message: isSuccess ? 'Transaction Successful' : body.failureReason || 'Insufficient funds in payer account',
        rrn,
        payerVpa: body.payerVpa,
        timestamp: new Date().toISOString(),
      };

      const signature = mockAdapter.signMockWebhook(bankPayload);

      // Trigger S2S Bank Webhook internally
      const callbackResult = await callbackHandler.handleCallback(
        txn.bankCode,
        {
          'x-bank-signature': signature,
          'content-type': 'application/json',
        },
        bankPayload
      );

      const refreshedTxn = txnService.getById(txn.id);

      return reply.send({
        success: true,
        simulation: {
          action: 'CUSTOMER_UPI_APP_PAYMENT_SIMULATED',
          payerVpa: body.payerVpa,
          bankReferenceId: rrn,
          bankWebhookDispatched: callbackResult.success,
          resultingLedgerStatus: refreshedTxn?.status,
        },
        transaction: refreshedTxn,
      });
    } catch (err: any) {
      return reply.status(400).send({
        error: 'SIMULATION_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * GET /api/v1/simulator/bank-health
   * Get health and success rates for all direct acquiring banks
   */
  server.get('/api/v1/simulator/bank-health', async (_req: FastifyRequest, reply: FastifyReply) => {
    const health = router.getHealthMetrics();
    return reply.send({
      success: true,
      data: health,
    });
  });
}
