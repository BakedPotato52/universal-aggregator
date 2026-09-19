import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { StoreOrderService } from '../../store/order.service.js';
import { TransactionService } from '../../core/ledger/transaction.service.js';
import { SmartRouter } from '../../core/routing/router.js';
import { BankAdapterRegistry } from '../../adapters/index.js';
import { UpiQrGenerator } from '../../upi/qr-generator.js';
import { UpiIntentBuilder } from '../../upi/intent.js';
import { BankCallbackHandler } from '../../webhooks/bank-callback.handler.js';
import { MockBankAdapter } from '../../adapters/mock/mock.adapter.js';
import { config } from '../../config/index.js';
import { PaymentRequest, BankCode } from '../../core/types.js';

const CheckoutSchema = z.object({
  customer: z.object({
    name: z.string().min(2, 'Full Name is required'),
    email: z.string().email('Valid email is required'),
    phone: z.string().min(10, 'Valid 10-digit phone number is required'),
    addressLine1: z.string().min(5, 'Delivery address is required'),
    addressLine2: z.string().optional(),
    city: z.string().min(2, 'City is required'),
    state: z.string().min(2, 'State is required'),
    pincode: z.string().min(6, 'Valid 6-digit PIN code is required'),
  }),
  variantId: z.string().optional(),
  quantity: z.number().int().positive().optional().default(1),
  addonIds: z.array(z.string()).optional(),
  couponCode: z.string().optional(),
  preferredBank: z.enum(['MOCK', 'HDFC', 'ICICI', 'AXIS']).optional(),
});

const CalculatePriceSchema = z.object({
  variantId: z.string().optional(),
  quantity: z.number().int().positive().optional().default(1),
  addonIds: z.array(z.string()).optional(),
  couponCode: z.string().optional(),
});

const SimulateStorePaySchema = z.object({
  orderId: z.string().min(1, 'orderId is required'),
  payerVpa: z.string().default('customer@okhdfcbank'),
  simulateFailure: z.boolean().default(false),
  failureReason: z.string().optional(),
});

export async function storeRoutes(server: FastifyInstance) {
  const storeService = StoreOrderService.getInstance();
  const txnService = TransactionService.getInstance();
  const router = new SmartRouter(config.routing.defaultBank as BankCode);
  const callbackHandler = BankCallbackHandler.getInstance();
  const mockAdapter = new MockBankAdapter();

  /**
   * GET /api/v1/store/product
   * Returns product catalog information
   */
  server.get('/api/v1/store/product', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      success: true,
      data: storeService.getProduct(),
    });
  });

  /**
   * POST /api/v1/store/pricing
   * Calculates live cart pricing with add-ons and coupons
   */
  server.post('/api/v1/store/pricing', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = CalculatePriceSchema.parse(req.body || {});
      const pricing = storeService.calculatePricing(body);
      return reply.send({
        success: true,
        data: pricing,
      });
    } catch (err: any) {
      return reply.status(400).send({
        error: 'CALCULATION_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * POST /api/v1/store/checkout
   * Creates store order + orchestrates payment session with Universal Payment Aggregator
   */
  server.post('/api/v1/store/checkout', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = CheckoutSchema.parse(req.body);

      // 1. Create pending merchant store order
      const order = storeService.createOrder({
        customer: body.customer,
        variantId: body.variantId,
        quantity: body.quantity,
        addonIds: body.addonIds,
        couponCode: body.couponCode,
      });

      // 2. Prepare Universal Aggregator Payment Request
      const paymentRequest: PaymentRequest = {
        merchantOrderId: order.orderId,
        amount: order.pricing.totalPayable,
        currency: 'INR',
        description: `AuraSound Apex 9 - Order #${order.orderId}`,
        method: 'UPI_QR',
        preferredBank: body.preferredBank,
        webhookUrl: `http://${config.host}:${config.port}/api/v1/store/webhooks`,
        customer: {
          name: order.customer.name,
          email: order.customer.email,
          phone: order.customer.phone,
        },
        metadata: {
          store: 'AuraSound DTC Flagship',
          orderId: order.orderId,
          variant: order.items[0]?.variantName,
          itemsCount: order.items.length,
        },
      };

      // 3. Route to optimal Acquiring Bank via Aggregator Smart Router
      const routingDecision = router.route(paymentRequest);
      const bankAdapter = BankAdapterRegistry.get(routingDecision.selectedBank);
      const merchantVpa = config.merchant.defaultVpa;

      // 4. Create Ledger Entry in Aggregator
      const txnRecord = txnService.createTransaction({
        request: paymentRequest,
        bankCode: routingDecision.selectedBank,
        merchantVpa,
      });

      // 5. Initiate Payment with Bank Adapter
      const bankResult = await bankAdapter.initiatePayment(paymentRequest, txnRecord);

      // 6. Generate Dynamic UPI QR and App Intent Deep Links
      const qrResult = await UpiQrGenerator.generate({
        params: {
          pa: merchantVpa,
          pn: config.merchant.name,
          mc: config.merchant.defaultMcc,
          tr: txnRecord.id,
          tn: `Order #${order.orderId}`,
          am: order.pricing.totalPayable,
          cu: 'INR',
          mode: '02',
        },
        size: 300,
      });

      const intentResult = UpiIntentBuilder.generateLinks({
        pa: merchantVpa,
        pn: config.merchant.name,
        mc: config.merchant.defaultMcc,
        tr: txnRecord.id,
        tn: `Order #${order.orderId}`,
        am: order.pricing.totalPayable,
        cu: 'INR',
        mode: '04',
      });

      // 7. Update Aggregator Ledger Status to PENDING
      txnService.updateStatus(txnRecord.id, 'PENDING', {
        bankTransactionId: bankResult.bankTransactionId,
        note: `Store checkout initiated. QR generated via [${routingDecision.selectedBank}]`,
      });

      // 8. Attach payment info to Store Order
      storeService.attachPaymentDetails(order.orderId, {
        transactionId: txnRecord.id,
        rawUri: qrResult.rawUri,
        bankCode: routingDecision.selectedBank,
        method: 'UPI_QR',
      });

      return reply.status(201).send({
        success: true,
        data: {
          order,
          payment: {
            transactionId: txnRecord.id,
            merchantOrderId: order.orderId,
            amount: order.pricing.totalPayable,
            currency: 'INR',
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
            intentLinks: {
              genericUpi: intentResult.genericUpiUri,
              gpay: intentResult.gpayUri,
              phonepe: intentResult.phonepeUri,
              paytm: intentResult.paytmUri,
              cred: intentResult.credUri,
              bhim: intentResult.bhimUri,
              webIntent: intentResult.webIntentUrl,
            },
          },
        },
      });
    } catch (err: any) {
      return reply.status(400).send({
        error: 'CHECKOUT_FAILED',
        message: err.message || 'Failed to process checkout request',
        issues: err.errors,
      });
    }
  });

  /**
   * GET /api/v1/store/orders/:orderId
   * Retrieve store order and live payment status
   */
  server.get(
    '/api/v1/store/orders/:orderId',
    async (req: FastifyRequest<{ Params: { orderId: string } }>, reply: FastifyReply) => {
      const { orderId } = req.params;
      const order = storeService.getOrder(orderId);

      if (!order) {
        return reply.status(404).send({
          error: 'ORDER_NOT_FOUND',
          message: `Store order [${orderId}] not found`,
        });
      }

      // Check live status from ledger if payment was pending
      if (order.status === 'PAYMENT_PENDING' && order.payment.aggregatorTransactionId) {
        const txn = txnService.getById(order.payment.aggregatorTransactionId);
        if (txn && txn.status === 'SUCCESS') {
          storeService.processWebhook({
            payload: {
              merchantOrderId: order.orderId,
              transactionId: txn.id,
              status: 'SUCCESS',
              bankReferenceId: txn.bankReferenceId,
              payerVpa: txn.payerVpa,
            },
          });
        }
      }

      return reply.send({
        success: true,
        data: storeService.getOrder(orderId),
      });
    }
  );

  /**
   * POST /api/v1/store/webhooks
   * S2S Merchant Webhook receiver from Universal Aggregator (HMAC-SHA256 verified)
   */
  server.post('/api/v1/store/webhooks', async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['x-webhook-signature'] as string | undefined;
    const payload = req.body;

    const result = storeService.processWebhook({
      signature,
      payload,
    });

    if (!result.success) {
      return reply.status(400).send({
        error: 'WEBHOOK_REJECTED',
        message: result.message,
      });
    }

    return reply.send({
      success: true,
      message: result.message,
      orderId: result.order?.orderId,
      status: result.order?.status,
    });
  });

  /**
   * POST /api/v1/store/simulate-pay
   * Interactive test button for simulator payment on merchant order
   */
  server.post('/api/v1/store/simulate-pay', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = SimulateStorePaySchema.parse(req.body);
      const order = storeService.getOrder(body.orderId);

      if (!order) {
        return reply.status(404).send({
          error: 'ORDER_NOT_FOUND',
          message: `Store order [${body.orderId}] was not found`,
        });
      }

      const txnId = order.payment.aggregatorTransactionId;
      const txn = txnId ? txnService.getById(txnId) : txnService.getByOrderId(order.orderId);

      if (!txn) {
        return reply.status(404).send({
          error: 'TRANSACTION_NOT_FOUND',
          message: 'Could not find payment transaction for this store order',
        });
      }

      const isSuccess = !body.simulateFailure;
      const rrn = `RRN_STORE_${Date.now()}`;

      // Construct Mock Bank Payload
      const bankPayload = {
        orderId: txn.merchantOrderId,
        amount: txn.amount.toFixed(2),
        status: isSuccess ? 'SUCCESS' : 'FAILED',
        responseCode: isSuccess ? '00' : 'U30',
        message: isSuccess ? 'Transaction Successful' : body.failureReason || 'Declined by customer bank',
        rrn,
        payerVpa: body.payerVpa,
        timestamp: new Date().toISOString(),
      };

      const signature = mockAdapter.signMockWebhook(bankPayload);

      // Trigger S2S Bank Webhook internally
      await callbackHandler.handleCallback(
        txn.bankCode,
        {
          'x-bank-signature': signature,
          'content-type': 'application/json',
        },
        bankPayload
      );

      // Update store order directly as well
      storeService.processWebhook({
        payload: {
          merchantOrderId: order.orderId,
          transactionId: txn.id,
          status: isSuccess ? 'SUCCESS' : 'FAILED',
          bankReferenceId: rrn,
          payerVpa: body.payerVpa,
        },
      });

      const updatedOrder = storeService.getOrder(order.orderId);

      return reply.send({
        success: true,
        simulation: {
          action: 'STORE_PAYMENT_SIMULATED',
          payerVpa: body.payerVpa,
          bankReferenceId: rrn,
          orderStatus: updatedOrder?.status,
        },
        order: updatedOrder,
      });
    } catch (err: any) {
      return reply.status(400).send({
        error: 'SIMULATION_ERROR',
        message: err.message,
      });
    }
  });
}
