export interface ProductVariant {
  id: string;
  name: string;
  colorName: string;
  colorHex: string;
  sku: string;
  imageUrl: string;
  inStock: boolean;
}

export interface ProductAddon {
  id: string;
  name: string;
  description: string;
  price: number;
  selectedByDefault?: boolean;
}

export interface StoreProduct {
  id: string;
  title: string;
  tagline: string;
  description: string;
  basePrice: number;
  originalPrice: number;
  currency: 'INR';
  rating: number;
  reviewsCount: number;
  variants: ProductVariant[];
  addons: ProductAddon[];
  features: Array<{
    title: string;
    description: string;
    icon: string;
  }>;
  specs: Record<string, string>;
  warranty: string;
  returnPolicy: string;
}

export interface CustomerShippingInfo {
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface OrderItem {
  productId: string;
  productTitle: string;
  variantId: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  addonIds: string[];
  addons: Array<{ id: string; name: string; price: number }>;
  totalItemPrice: number;
}

export interface OrderPriceBreakdown {
  subtotal: number;
  addonsTotal: number;
  grossAmount: number;
  discountAmount: number;
  couponCode?: string;
  taxableAmount: number;
  cgst: number; // 9%
  sgst: number; // 9%
  totalTax: number;
  shippingFee: number;
  totalPayable: number;
}

export type StoreOrderStatus =
  | 'INITIATED'
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface StoreOrder {
  orderId: string;
  status: StoreOrderStatus;
  customer: CustomerShippingInfo;
  items: OrderItem[];
  pricing: OrderPriceBreakdown;
  payment: {
    aggregatorTransactionId?: string;
    method?: string;
    bankCode?: string;
    bankReferenceId?: string; // RRN / UTR
    payerVpa?: string;
    paidAt?: string;
    rawUri?: string;
  };
  tracking: {
    carrier?: string;
    trackingNumber?: string;
    estimatedDelivery?: string;
  };
  createdAt: string;
  updatedAt: string;
}
