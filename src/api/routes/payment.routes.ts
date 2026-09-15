import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SmartRouter } from '../../core/routing/router.js';
import { IdempotencyManager } from '../../core/idempotency/idempotency.manager.js';
import { TransactionService } from '../../core/ledger/transaction.service.js';
import { BankAdapterRegistry } from '../../adapters/index.js';
import { UpiQrGenerator } from '../../upi/qr-generator.js';
import { UpiIntentBuilder } from '../../upi/intent.js';
import { UpiValidator } from '../../upi/validator.js';
import { PaymentRequest, BankCode, PaymentMethod } from '../../core/types.js';
import { config } from '../../config/index.js';

const CreateUpiPaymentSchema = z.object({
  merchantOrderId: z.string().min(1, 'merchantOrderId is required'),
  amount: z.number().positive('amount must be greater than 0'),
  currency: z.literal('INR').default('INR'),
  description: z.string().optional(),
  payerVpa: z.string().optional(),
  preferredBank: z.enum(['MOCK', 'HDFC', 'ICICI', 'AXIS']).optional(),
  webhookUrl: z.string().url().optional(),
  expiresInSeconds: z.number().int().positive().optional().default(900),
  customer: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      vpa: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.any()).optional(),
});

export async function paymentRoutes(server: FastifyInstance) {
  const router = new SmartRouter(config.routing.defaultBank as BankCode);
  const idempotency = IdempotencyManager.getInstance(config.idempotency.ttlSeconds);
  const txnService = TransactionService.getInstance();

  /**
   * POST /api/v1/payments/upi/qr
   * Generate Dynamic UPI QR Code
   */
  server.post('/api/v1/payments/upi/qr', async (req: FastifyRequest, reply: FastifyReply) => {
    const idempotencyKey = (req.headers['x-idempotency-key'] as string) || (req.body as any)?.merchantOrderId;

    let lockToken: string | undefined = undefined;

    if (idempotencyKey) {
      const lock = await idempotency.acquireLock(idempotencyKey, req.body);
      if (!lock.acquired) {
        if (lock.mismatch) {
          return reply.status(422).send({
            error: 'IDEMPOTENCY_MISMATCH',
            message: 'Idempotency key was previously used with a different request body',
          });
        }
        if (lock.inFlight) {
          return reply.status(409).send({
            error: 'CONCURRENT_REQUEST',
            message: 'A request with this idempotency key is currently processing. Please retry.',
          });
        }
        if (lock.cachedResponse) {
          reply.header('X-Cache-Hit', 'true');
          return reply.status(lock.cachedResponse.statusCode).send(lock.cachedResponse.body);
        }
      }
      lockToken = lock.lockToken;
    }

    try {
      const body = CreateUpiPaymentSchema.parse(req.body);

      // Route to optimal Acquiring Bank
      const paymentRequest: PaymentRequest = {
        ...body,
        method: 'UPI_QR',
      };
      const routingDecision = router.route(paymentRequest);
      const bankAdapter = BankAdapterRegistry.get(routingDecision.selectedBank);

      // Create ledger entry
      const merchantVpa = config.merchant.defaultVpa;
      const txnRecord = txnService.createTransaction({
        request: paymentRequest,
        bankCode: routingDecision.selectedBank,
        merchantVpa,
      });

      // Initiate payment via Bank Adapter
      const bankResult = await bankAdapter.initiatePayment(paymentRequest, txnRecord);

      // Generate Dynamic QR Code rendering
      const qrResult = await UpiQrGenerator.generate({
        params: {
          pa: merchantVpa,
          pn: config.merchant.name,
          mc: config.merchant.defaultMcc,
          tr: txnRecord.id,
          tn: body.description || `Order #${body.merchantOrderId}`,
          am: body.amount,
          cu: 'INR',
          mode: '02',
        },
        size: 320,
      });

      // Update ledger with generated URI and Bank Txn ID
      txnService.updateStatus(txnRecord.id, 'PENDING', {
        bankTransactionId: bankResult.bankTransactionId,
        note: `Dynamic QR generated via [${routingDecision.selectedBank}] (${routingDecision.reason})`,
      });

      const responseData = {
        success: true,
        data: {
          transactionId: txnRecord.id,
          merchantOrderId: txnRecord.merchantOrderId,
          amount: txnRecord.amount,
          currency: txnRecord.currency,
          status: 'PENDING',
          method: 'UPI_QR',
          bankCode: routingDecision.selectedBank,
          routingInfo: {
            selectedBank: routingDecision.selectedBank,
            reason: routingDecision.reason,
          },
          upi: {
            rawUri: qrResult.rawUri,
            qrDataUrl: qrResult.qrDataUrl,
            qrSvg: qrResult.qrSvg,
            payeeVpa: qrResult.payeeVpa,
            payeeName: config.merchant.name,
            expiresAt: qrResult.expiresAt,
          },
          createdAt: txnRecord.createdAt,
        },
      };

      if (idempotencyKey) {
        await idempotency.saveResponse(idempotencyKey, 201, responseData, req.body, lockToken);
      }

      return reply.status(201).send(responseData);
    } catch (err: any) {
      if (idempotencyKey) {
        await idempotency.releaseLock(idempotencyKey, lockToken);
      }
      return reply.status(400).send({
        error: 'PAYMENT_CREATION_FAILED',
        message: err.message || 'Failed to create UPI QR payment',
        issues: err.errors,
      });
    }
  });

  /**
   * POST /api/v1/payments/upi/intent
   * Generate App-to-App Intent Deep Links
   */
  server.post('/api/v1/payments/upi/intent', async (req: FastifyRequest, reply: FastifyReply) => {
    const idempotencyKey = (req.headers['x-idempotency-key'] as string) || (req.body as any)?.merchantOrderId;
    let lockToken: string | undefined = undefined;

    if (idempotencyKey) {
      const lock = await idempotency.acquireLock(idempotencyKey, req.body);
      if (!lock.acquired) {
        if (lock.cachedResponse) {
          reply.header('X-Cache-Hit', 'true');
          return reply.status(lock.cachedResponse.statusCode).send(lock.cachedResponse.body);
        }
      }
      lockToken = lock.lockToken;
    }

    try {
      const body = CreateUpiPaymentSchema.parse(req.body);

      const paymentRequest: PaymentRequest = {
        ...body,
        method: 'UPI_INTENT',
      };
      const routingDecision = router.route(paymentRequest);
      const bankAdapter = BankAdapterRegistry.get(routingDecision.selectedBank);

      const merchantVpa = config.merchant.defaultVpa;
      const txnRecord = txnService.createTransaction({
        request: paymentRequest,
        bankCode: routingDecision.selectedBank,
        merchantVpa,
      });

      const bankResult = await bankAdapter.initiatePayment(paymentRequest, txnRecord);

      // Generate Intent Links for GPay, PhonePe, Paytm, CRED, BHIM
      const intentResult = UpiIntentBuilder.generateLinks({
        pa: merchantVpa,
        pn: config.merchant.name,
        mc: config.merchant.defaultMcc,
        tr: txnRecord.id,
        tn: body.description || `Order #${body.merchantOrderId}`,
        am: body.amount,
        cu: 'INR',
        mode: '04',
      });

      txnService.updateStatus(txnRecord.id, 'PENDING', {
        bankTransactionId: bankResult.bankTransactionId,
        note: `UPI Intent links generated via [${routingDecision.selectedBank}]`,
      });

      const responseData = {
        success: true,
        data: {
          transactionId: txnRecord.id,
          merchantOrderId: txnRecord.merchantOrderId,
          amount: txnRecord.amount,
          currency: txnRecord.currency,
          status: 'PENDING',
          method: 'UPI_INTENT',
          bankCode: routingDecision.selectedBank,
          intentLinks: {
            genericUpi: intentResult.genericUpiUri,
            gpay: intentResult.gpayUri,
            phonepe: intentResult.phonepeUri,
            paytm: intentResult.paytmUri,
            cred: intentResult.credUri,
            bhim: intentResult.bhimUri,
            webIntent: intentResult.webIntentUrl,
          },
          createdAt: txnRecord.createdAt,
          expiresAt: txnRecord.expiresAt,
        },
      };

      if (idempotencyKey) {
        await idempotency.saveResponse(idempotencyKey, 201, responseData, req.body, lockToken);
      }

      return reply.status(201).send(responseData);
    } catch (err: any) {
      if (idempotencyKey) {
        await idempotency.releaseLock(idempotencyKey, lockToken);
      }
      return reply.status(400).send({
        error: 'INTENT_CREATION_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * POST /api/v1/payments/upi/collect
   * Direct UPI Collect request to customer VPA
   */
  server.post('/api/v1/payments/upi/collect', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = CreateUpiPaymentSchema.extend({
        payerVpa: z.string().min(3, 'payerVpa is required for UPI Collect'),
      }).parse(req.body);

      if (!UpiValidator.isValidVpa(body.payerVpa)) {
        return reply.status(400).send({
          error: 'INVALID_VPA',
          message: `The provided VPA [${body.payerVpa}] is not in a valid format (e.g. name@bank)`,
        });
      }

      const paymentRequest: PaymentRequest = {
        ...body,
        method: 'UPI_COLLECT',
      };
      const routingDecision = router.route(paymentRequest);
      const bankAdapter = BankAdapterRegistry.get(routingDecision.selectedBank);

      const txnRecord = txnService.createTransaction({
        request: paymentRequest,
        bankCode: routingDecision.selectedBank,
        merchantVpa: config.merchant.defaultVpa,
      });

      const bankResult = await bankAdapter.initiatePayment(paymentRequest, txnRecord);

      txnService.updateStatus(txnRecord.id, 'PENDING', {
        bankTransactionId: bankResult.bankTransactionId,
        payerVpa: body.payerVpa,
        note: `UPI Collect request dispatched to [${body.payerVpa}] via [${routingDecision.selectedBank}]`,
      });

      return reply.status(201).send({
        success: true,
        data: {
          transactionId: txnRecord.id,
          merchantOrderId: txnRecord.merchantOrderId,
          amount: txnRecord.amount,
          payerVpa: body.payerVpa,
          status: 'PENDING',
          method: 'UPI_COLLECT',
          bankCode: routingDecision.selectedBank,
          message: `Collect request sent to ${body.payerVpa}. Awaiting customer UPI PIN entry.`,
        },
      });
    } catch (err: any) {
      return reply.status(400).send({
        error: 'COLLECT_REQUEST_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * GET /api/v1/payments/:id/status
   * Inquire payment status
   */
  server.get('/api/v1/payments/:id/status', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;

    let txn = txnService.getById(id);
    if (!txn) {
      txn = txnService.getByOrderId(id);
    }

    if (!txn) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `Transaction not found for identifier [${id}]`,
      });
    }

    return reply.send({
      success: true,
      data: txn,
    });
  });

  /**
   * GET /api/v1/payments
   * List transactions
   */
  server.get('/api/v1/payments', async (req: FastifyRequest<{ Querystring: { status?: string; bankCode?: string; limit?: string; offset?: string } }>, reply: FastifyReply) => {
    const { status, bankCode, limit, offset } = req.query;

    const results = txnService.list({
      status: status as any,
      bankCode: bankCode as any,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    return reply.send({
      success: true,
      data: results.data,
      total: results.total,
    });
  });

  /**
   * POST /api/v1/payments/:id/refund
   * Issue a refund
   */
  server.post('/api/v1/payments/:id/refund', async (req: FastifyRequest<{ Params: { id: string }; Body: { amount?: number; reason?: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const body = req.body || {};

    const txn = txnService.getById(id) || txnService.getByOrderId(id);
    if (!txn) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `Transaction [${id}] not found`,
      });
    }

    if (txn.status !== 'SUCCESS') {
      return reply.status(400).send({
        error: 'INVALID_STATE',
        message: `Cannot refund a transaction in [${txn.status}] state. Only SUCCESS payments can be refunded.`,
      });
    }

    const refundAmount = body.amount || txn.amount;
    const adapter = BankAdapterRegistry.get(txn.bankCode);
    const refundResult = await adapter.refundPayment(txn, refundAmount, body.reason || 'Merchant requested refund');

    if (refundResult.success) {
      txnService.updateStatus(txn.id, 'REFUNDED', {
        note: `Refund processed: ₹${refundAmount} (Refund ID: ${refundResult.refundId})`,
      });
    }

    return reply.send({
      success: refundResult.success,
      data: {
        refundId: refundResult.refundId,
        transactionId: txn.id,
        amount: refundAmount,
        status: refundResult.status,
      },
    });
  });
}
