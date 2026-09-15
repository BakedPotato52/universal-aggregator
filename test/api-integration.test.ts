import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/api/server.js';
import { MockBankAdapter } from '../src/adapters/mock/mock.adapter.js';

describe('Payment API End-to-End Integration', () => {
  let app: FastifyInstance;
  const mockAdapter = new MockBankAdapter();

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return UP on /health', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('UP');
  });

  it('should create Dynamic UPI QR and handle end-to-end bank callback lifecycle', async () => {
    const orderId = 'ORD_E2E_' + Date.now();

    // 1. Create UPI QR Payment
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/upi/qr',
      headers: {
        'x-idempotency-key': orderId,
      },
      payload: {
        merchantOrderId: orderId,
        amount: 350.0,
        preferredBank: 'MOCK',
        description: 'Test E2E Payment',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createJson = JSON.parse(createRes.payload);
    expect(createJson.success).toBe(true);
    expect(createJson.data.status).toBe('PENDING');
    expect(createJson.data.upi.rawUri).toContain('upi://pay?');
    expect(createJson.data.upi.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const txnId = createJson.data.transactionId;

    // 2. Test Idempotency Cache Hit
    const duplicateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/upi/qr',
      headers: {
        'x-idempotency-key': orderId,
      },
      payload: {
        merchantOrderId: orderId,
        amount: 350.0,
        preferredBank: 'MOCK',
        description: 'Test E2E Payment',
      },
    });
    expect(duplicateRes.statusCode).toBe(201);
    expect(duplicateRes.headers['x-cache-hit']).toBe('true');

    // 3. Simulate S2S Bank Webhook Callback
    const bankPayload = {
      orderId,
      amount: '350.00',
      status: 'SUCCESS',
      responseCode: '00',
      rrn: 'RRN_E2E_998811',
      payerVpa: 'payer@okhdfcbank',
    };
    const signature = mockAdapter.signMockWebhook(bankPayload);

    const webhookRes = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/bank/MOCK',
      headers: {
        'x-bank-signature': signature,
      },
      payload: bankPayload,
    });

    expect(webhookRes.statusCode).toBe(200);
    const webhookJson = JSON.parse(webhookRes.payload);
    expect(webhookJson.status).toBe('SUCCESS');

    // 4. Inquire Payment Status
    const statusRes = await app.inject({
      method: 'GET',
      url: `/api/v1/payments/${txnId}/status`,
    });

    expect(statusRes.statusCode).toBe(200);
    const statusJson = JSON.parse(statusRes.payload);
    expect(statusJson.data.status).toBe('SUCCESS');
    expect(statusJson.data.bankReferenceId).toBe('RRN_E2E_998811');
    expect(statusJson.data.payerVpa).toBe('payer@okhdfcbank');

    // 5. Test Refund
    const refundRes = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${txnId}/refund`,
      payload: {
        amount: 350.0,
        reason: 'Customer cancelled order',
      },
    });

    expect(refundRes.statusCode).toBe(200);
    const refundJson = JSON.parse(refundRes.payload);
    expect(refundJson.success).toBe(true);
    expect(refundJson.data.status).toBe('SUCCESS');
  });

  it('should generate Intent deep links for mobile UPI apps', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/upi/intent',
      payload: {
        merchantOrderId: 'ORD_INTENT_' + Date.now(),
        amount: 199.0,
        description: 'App In-Store Intent',
      },
    });

    expect(res.statusCode).toBe(201);
    const json = JSON.parse(res.payload);
    expect(json.data.intentLinks.gpay).toContain('tez://upi/pay?');
    expect(json.data.intentLinks.phonepe).toContain('phonepe://pay?');
    expect(json.data.intentLinks.paytm).toContain('paytmmp://pay?');
    expect(json.data.intentLinks.cred).toContain('cred://upi/pay?');
    expect(json.data.intentLinks.bhim).toContain('bhim://pay?');
  });
});
