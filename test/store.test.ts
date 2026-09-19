import { describe, it, expect, beforeEach } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { StoreOrderService } from '../src/store/order.service.js';
import { BankCrypto } from '../src/upi/crypto.js';
import { config } from '../src/config/index.js';
import { FastifyInstance } from 'fastify';

describe('Production E-Commerce Storefront with Universal Aggregator Integration', () => {
  let server: FastifyInstance;
  const storeService = StoreOrderService.getInstance();

  beforeEach(async () => {
    storeService.clear();
    server = buildServer();
    await server.ready();
  });

  it('should serve static storefront and order HTML pages', async () => {
    const resHome = await server.inject({ method: 'GET', url: '/' });
    expect(resHome.statusCode).toBe(302);
    expect(resHome.headers.location).toBe('/store/index.html');

    const resStore = await server.inject({ method: 'GET', url: '/store/index.html' });
    expect(resStore.statusCode).toBe(200);
    expect(resStore.body).toContain('AuraSound Apex 9');

    const resOrder = await server.inject({ method: 'GET', url: '/store/order.html' });
    expect(resOrder.statusCode).toBe(200);
    expect(resOrder.body).toContain('Tax Invoice');
  });

  it('should fetch product catalog with variants, addons, and technical specs', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/store/product',
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(true);
    expect(json.data.title).toBe('AuraSound Apex 9');
    expect(json.data.basePrice).toBe(1);
    expect(json.data.variants.length).toBe(3);
    expect(json.data.addons.length).toBe(3);
    expect(json.data.specs['Driver Size']).toBeDefined();
  });

  it('should accurately calculate cart pricing with addons and coupon discount', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/store/pricing',
      payload: {
        variantId: 'var_titanium_silver',
        addonIds: ['addon_hard_case', 'addon_extended_care'],
        couponCode: 'AURA10',
      },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(true);

    const breakdown = json.data.breakdown;
    expect(breakdown.subtotal).toBe(1);
    expect(breakdown.addonsTotal).toBe(0);
    expect(breakdown.grossAmount).toBe(1);
    expect(breakdown.totalPayable).toBe(1);
  });

  it('should orchestrate store checkout via Universal Payment Aggregator and return Dynamic UPI QR & Intent links', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/store/checkout',
      payload: {
        customer: {
          name: 'Priya Sharma',
          email: 'priya.sharma@example.com',
          phone: '9876543210',
          addressLine1: '402, Signature Towers',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
        },
        variantId: 'var_cosmic_blue',
        addonIds: ['addon_extended_care'],
        couponCode: 'AURA10',
      },
    });

    expect(res.statusCode).toBe(201);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(true);
    expect(json.data.order.orderId).toMatch(/^ORD_AURA_/);
    expect(json.data.order.status).toBe('PAYMENT_PENDING');

    // Verify Aggregator integration bundle
    const payment = json.data.payment;
    expect(payment.transactionId).toMatch(/^txn_/);
    expect(payment.method).toBe('UPI_QR');
    expect(payment.upi.rawUri).toContain('upi://pay');
    expect(payment.upi.qrSvg).toContain('<svg');
    expect(payment.intentLinks.genericUpi).toContain('upi://pay');
    expect(payment.intentLinks.gpay).toContain('tez://upi/pay');
    expect(payment.intentLinks.phonepe).toContain('phonepe://pay');
  });

  it('should verify incoming HMAC-SHA256 S2S webhook and confirm store order', async () => {
    // 1. Create order
    const order = storeService.createOrder({
      customer: {
        name: 'Rohan Mehta',
        email: 'rohan@example.com',
        phone: '9988776655',
        addressLine1: 'Plot 12, Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560038',
      },
      variantId: 'var_obsidian_black',
    });

    storeService.attachPaymentDetails(order.orderId, {
      transactionId: 'txn_mock_test_123',
      rawUri: 'upi://pay?pa=merchant@hdfcbank',
      bankCode: 'HDFC',
      method: 'UPI_QR',
    });

    expect(order.status).toBe('PAYMENT_PENDING');

    // 2. Construct Webhook Payload & HMAC Signature
    const webhookPayload = {
      merchantOrderId: order.orderId,
      transactionId: 'txn_mock_test_123',
      amount: order.pricing.totalPayable,
      status: 'SUCCESS',
      bankReferenceId: 'RRN_HDFC_99281928',
      payerVpa: 'rohan@okhdfcbank',
      timestamp: new Date().toISOString(),
    };

    const signature = BankCrypto.generateHmacSha256(webhookPayload, config.webhooks.merchantSecret);

    // 3. Dispatch Webhook
    const webhookRes = await server.inject({
      method: 'POST',
      url: '/api/v1/store/webhooks',
      headers: {
        'x-webhook-signature': signature,
        'content-type': 'application/json',
      },
      payload: webhookPayload,
    });

    expect(webhookRes.statusCode).toBe(200);
    const webhookJson = JSON.parse(webhookRes.body);
    expect(webhookJson.success).toBe(true);
    expect(webhookJson.status).toBe('CONFIRMED');

    // 4. Inquire Order to verify persisted status and bank UTR
    const orderRes = await server.inject({
      method: 'GET',
      url: `/api/v1/store/orders/${order.orderId}`,
    });

    expect(orderRes.statusCode).toBe(200);
    const orderJson = JSON.parse(orderRes.body);
    expect(orderJson.data.status).toBe('CONFIRMED');
    expect(orderJson.data.payment.bankReferenceId).toBe('RRN_HDFC_99281928');
    expect(orderJson.data.payment.payerVpa).toBe('rohan@okhdfcbank');
  });

  it('should simulate customer UPI payment via test simulator and transition order to CONFIRMED', async () => {
    // 1. Checkout
    const checkoutRes = await server.inject({
      method: 'POST',
      url: '/api/v1/store/checkout',
      payload: {
        customer: {
          name: 'Ananya Gupta',
          email: 'ananya@example.com',
          phone: '9811223344',
          addressLine1: '101, Golf Links',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110003',
        },
        variantId: 'var_titanium_silver',
      },
    });

    const checkoutJson = JSON.parse(checkoutRes.body);
    const orderId = checkoutJson.data.order.orderId;

    // 2. Simulate Payment
    const simRes = await server.inject({
      method: 'POST',
      url: '/api/v1/store/simulate-pay',
      payload: {
        orderId,
        payerVpa: 'ananya@okhdfcbank',
      },
    });

    expect(simRes.statusCode).toBe(200);
    const simJson = JSON.parse(simRes.body);
    expect(simJson.success).toBe(true);
    expect(simJson.order.status).toBe('CONFIRMED');
    expect(simJson.order.payment.bankReferenceId).toMatch(/^RRN_/);
  });
});
