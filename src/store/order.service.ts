import crypto from 'crypto';
import {
  StoreProduct,
  StoreOrder,
  CustomerShippingInfo,
  OrderPriceBreakdown,
  OrderItem,
  StoreOrderStatus,
} from './types.js';
import { BankCrypto } from '../upi/crypto.js';
import { config } from '../config/index.js';

export class StoreOrderService {
  private static instance: StoreOrderService;
  private orders: Map<string, StoreOrder> = new Map();
  private txnIdToOrderId: Map<string, string> = new Map();

  // Flagship Product Catalog Definition
  private product: StoreProduct = {
    id: 'prod_aurasound_apex9',
    title: 'AuraSound Apex 9',
    tagline: 'Ultra-Fidelity Spatial Wireless ANC Headphones',
    description:
      'Engineered for true audiophiles and creators. Features 45mm custom Beryllium acoustic drivers, 48dB Hybrid Adaptive Active Noise Cancellation, Lossless LDAC/aptX HD codecs, and up to 65 hours of battery endurance crafted in an aerospace-grade CNC aluminum enclosure.',
    basePrice: 1,
    originalPrice: 24999,
    currency: 'INR',
    rating: 4.9,
    reviewsCount: 1284,
    variants: [
      {
        id: 'var_obsidian_black',
        name: 'Obsidian Black',
        colorName: 'Obsidian Black (Matte PVD)',
        colorHex: '#1e2022',
        sku: 'AURA-APEX9-BLK',
        imageUrl: '/store/assets/headphone-black.png',
        inStock: true,
      },
      {
        id: 'var_titanium_silver',
        name: 'Titanium Silver',
        colorName: 'Titanium Silver (Anodized Satin)',
        colorHex: '#d1d5db',
        sku: 'AURA-APEX9-SLV',
        imageUrl: '/store/assets/headphone-silver.png',
        inStock: true,
      },
      {
        id: 'var_cosmic_blue',
        name: 'Cosmic Blue',
        colorName: 'Cosmic Blue (Midnight Deep)',
        colorHex: '#1e3a8a',
        sku: 'AURA-APEX9-BLU',
        imageUrl: '/store/assets/headphone-blue.png',
        inStock: true,
      },
    ],
    addons: [
      {
        id: 'addon_hard_case',
        name: 'Magnetic Armor Hard Travel Case',
        description: 'Water-repellent ballistic nylon shell with magnetic cable organizers',
        price: 0,
        selectedByDefault: false,
      },
      {
        id: 'addon_braided_cable',
        name: 'Custom 4.4mm Balanced Silver Cable',
        description: 'Ultra-pure OCC silver-plated copper for audiophile desktop DACs',
        price: 0,
        selectedByDefault: false,
      },
      {
        id: 'addon_extended_care',
        name: 'AuraCare 2-Year Full Protection',
        description: 'Accidental damage & liquid protection with free express replacement',
        price: 0,
        selectedByDefault: true,
      },
    ],
    features: [
      {
        title: '45mm Custom Beryllium Drivers',
        description: 'Ultra-stiff diaphragm delivering 5Hz - 45kHz frequency response with 0.05% THD.',
        icon: 'speaker',
      },
      {
        title: '48dB Hybrid Adaptive ANC',
        description: '6-microphone array sampling ambient noise 380,000 times per second for silence.',
        icon: 'shield-check',
      },
      {
        title: '65-Hour Battery + Fast Charge',
        description: '65 hours on a single charge. 10 minutes of USB-C fast charge delivers 8 hours playback.',
        icon: 'battery-charging',
      },
      {
        title: 'Lossless Hi-Res Wireless',
        description: 'Equipped with Sony LDAC, Qualcomm aptX Adaptive, and Bluetooth 5.4 Multipoint.',
        icon: 'sparkles',
      },
    ],
    specs: {
      'Driver Size': '45mm Pure Beryllium Dynamic Transducers',
      'Frequency Response': '5 Hz - 45,000 Hz (Hi-Res Certified)',
      'Impedance': '32 Ohms @ 1 kHz',
      'Sensitivity': '118 dB SPL / mW',
      'Noise Cancellation': 'Hybrid Active Noise Cancellation (-48dB Peak)',
      'Microphones': '6 MEMS Mics with Beamforming ENC for Crystal Calls',
      'Connectivity': 'Bluetooth 5.4 Multipoint + 3.5mm Aux + USB-C Lossless Audio',
      'Supported Codecs': 'LDAC, aptX HD, aptX Lossless, AAC, SBC',
      'Battery Capacity': '1,100 mAh Lithium-Polymer (65h ANC off / 48h ANC on)',
      'Charging Time': '75 minutes full charge via USB Power Delivery (USB-PD)',
      'Weight': '268 grams',
      'Materials': 'CNC Aluminum Alloy, Magnesium Yoke, Memory Foam Protein Leather',
    },
    warranty: '1 Year Comprehensive Manufacturer Replacement Warranty',
    returnPolicy: '7-Day Hassle-Free Return / Replacement Guarantee across India',
  };

  private constructor() {}

  public static getInstance(): StoreOrderService {
    if (!StoreOrderService.instance) {
      StoreOrderService.instance = new StoreOrderService();
    }
    return StoreOrderService.instance;
  }

  public getProduct(): StoreProduct {
    return this.product;
  }

  /**
   * Calculates pricing and itemization for given variant, quantity, addons, and promo code
   */
  public calculatePricing(params: {
    variantId?: string;
    quantity?: number;
    addonIds?: string[];
    couponCode?: string;
  }): {
    breakdown: OrderPriceBreakdown;
    selectedVariant: any;
    selectedAddons: any[];
  } {
    const variant =
      this.product.variants.find((v) => v.id === params.variantId) || this.product.variants[0];
    const qty = Math.max(1, params.quantity || 1);
    const subtotal = this.product.basePrice * qty;

    const selectedAddons = (params.addonIds || [])
      .map((id) => this.product.addons.find((a) => a.id === id))
      .filter(Boolean) as Array<{ id: string; name: string; price: number }>;

    const addonsTotal = selectedAddons.reduce((sum, item) => sum + item.price, 0);
    const grossAmount = subtotal + addonsTotal;

    // Promo code discounts
    let discountAmount = 0;
    const cleanCoupon = (params.couponCode || '').trim().toUpperCase();

    if (cleanCoupon === 'AURA10') {
      discountAmount = Math.round(grossAmount * 0.1); // 10% off
    } else if (cleanCoupon === 'EARLYBIRD') {
      discountAmount = Math.min(grossAmount, 1000); // ₹1,000 flat discount
    }

    const discountedGross = Math.max(1, grossAmount - discountAmount);
    // GST 18% inclusive breakdown (taxable = gross / 1.18)
    const taxableAmount = Math.round((discountedGross / 1.18) * 100) / 100;
    const totalTax = Math.round((discountedGross - taxableAmount) * 100) / 100;
    const cgst = Math.round((totalTax / 2) * 100) / 100;
    const sgst = Math.round((totalTax / 2) * 100) / 100;

    const shippingFee = 0; // Free express delivery
    const totalPayable = discountedGross + shippingFee;

    const breakdown: OrderPriceBreakdown = {
      subtotal,
      addonsTotal,
      grossAmount,
      discountAmount,
      couponCode: discountAmount > 0 ? cleanCoupon : undefined,
      taxableAmount,
      cgst,
      sgst,
      totalTax,
      shippingFee,
      totalPayable,
    };

    return {
      breakdown,
      selectedVariant: variant,
      selectedAddons,
    };
  }

  /**
   * Creates a new store order in INITIATED state
   */
  public createOrder(params: {
    customer: CustomerShippingInfo;
    variantId?: string;
    quantity?: number;
    addonIds?: string[];
    couponCode?: string;
  }): StoreOrder {
    const orderId = `ORD_AURA_${Date.now().toString(36).toUpperCase()}_${crypto
      .randomBytes(3)
      .toString('hex')
      .toUpperCase()}`;
    const now = new Date().toISOString();

    const { breakdown, selectedVariant, selectedAddons } = this.calculatePricing({
      variantId: params.variantId,
      quantity: params.quantity,
      addonIds: params.addonIds,
      couponCode: params.couponCode,
    });

    const qty = Math.max(1, params.quantity || 1);
    const item: OrderItem = {
      productId: this.product.id,
      productTitle: this.product.title,
      variantId: selectedVariant.id,
      variantName: selectedVariant.name,
      quantity: qty,
      unitPrice: this.product.basePrice,
      addonIds: selectedAddons.map((a) => a.id),
      addons: selectedAddons,
      totalItemPrice: breakdown.grossAmount,
    };

    // Calculate estimated delivery: 3 days from now
    const deliveryDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const estimatedDelivery = deliveryDate.toLocaleDateString('en-IN', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    const order: StoreOrder = {
      orderId,
      status: 'INITIATED',
      customer: params.customer,
      items: [item],
      pricing: breakdown,
      payment: {},
      tracking: {
        carrier: 'BlueDart Express Air Cargo',
        trackingNumber: `BD${Date.now().toString().slice(-8)}IN`,
        estimatedDelivery,
      },
      createdAt: now,
      updatedAt: now,
    };

    this.orders.set(orderId, order);
    return order;
  }

  /**
   * Associates the Universal Aggregator Transaction details with the store order
   */
  public attachPaymentDetails(
    orderId: string,
    paymentDetails: {
      transactionId: string;
      rawUri?: string;
      bankCode?: string;
      method?: string;
    }
  ): StoreOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    order.status = 'PAYMENT_PENDING';
    order.payment.aggregatorTransactionId = paymentDetails.transactionId;
    order.payment.rawUri = paymentDetails.rawUri;
    order.payment.bankCode = paymentDetails.bankCode;
    order.payment.method = paymentDetails.method;
    order.updatedAt = new Date().toISOString();

    this.txnIdToOrderId.set(paymentDetails.transactionId, orderId);
    return order;
  }

  /**
   * Processes S2S Webhook from Universal Aggregator and confirms the order
   */
  public processWebhook(params: {
    signature?: string;
    payload: any;
  }): { success: boolean; message: string; order?: StoreOrder } {
    const secret = config.webhooks.merchantSecret;

    // Verify HMAC-SHA256 signature if provided
    if (params.signature) {
      const isValid = BankCrypto.verifyHmacSha256(params.payload, secret, params.signature);
      if (!isValid) {
        return { success: false, message: 'Invalid HMAC signature on incoming merchant webhook' };
      }
    }

    const payload = params.payload;
    const merchantOrderId = payload.merchantOrderId || payload.orderId;
    const txnId = payload.transactionId || payload.id;
    const status = payload.status;
    const bankRefId = payload.bankReferenceId || payload.rrn;
    const payerVpa = payload.payerVpa;

    let order = merchantOrderId ? this.orders.get(merchantOrderId) : undefined;
    if (!order && txnId) {
      const lookupOrderId = this.txnIdToOrderId.get(txnId);
      if (lookupOrderId) order = this.orders.get(lookupOrderId);
    }

    if (!order) {
      return { success: false, message: `No store order found for orderId=[${merchantOrderId}], txnId=[${txnId}]` };
    }

    const now = new Date().toISOString();
    order.updatedAt = now;

    if (status === 'SUCCESS') {
      order.status = 'CONFIRMED';
      order.payment.bankReferenceId = bankRefId || `RRN${Date.now()}`;
      order.payment.payerVpa = payerVpa || order.payment.payerVpa || 'customer@okhdfcbank';
      order.payment.paidAt = now;
      order.payment.aggregatorTransactionId = txnId || order.payment.aggregatorTransactionId;
    } else if (status === 'FAILED') {
      order.status = 'CANCELLED';
    }

    return {
      success: true,
      message: `Store order ${order.orderId} updated to ${order.status}`,
      order,
    };
  }

  public getOrder(orderId: string): StoreOrder | undefined {
    return this.orders.get(orderId);
  }

  public getOrderByTxnId(txnId: string): StoreOrder | undefined {
    const orderId = this.txnIdToOrderId.get(txnId);
    return orderId ? this.orders.get(orderId) : undefined;
  }

  public listOrders(): StoreOrder[] {
    return Array.from(this.orders.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public clear(): void {
    this.orders.clear();
    this.txnIdToOrderId.clear();
  }
}
