import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  merchant: {
    name: string;
    defaultVpa: string;
    defaultMcc: string;
  };
  routing: {
    defaultBank: string; // 'MOCK' | 'HDFC' | 'ICICI' | 'AXIS' | 'SMART_ROUTED'
  };
  banks: {
    hdfc: {
      mid: string;
      terminalId: string;
      secretKey: string;
      apiBaseUrl: string;
    };
    icici: {
      merchantId: string;
      subMerchantId: string;
      aesKey: string;
      apiBaseUrl: string;
    };
    axis: {
      merchantId: string;
      checksumKey: string;
      apiBaseUrl: string;
    };
  };
  webhooks: {
    merchantSecret: string;
    maxRetries: number;
  };
  idempotency: {
    ttlSeconds: number;
  };
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5432/universal_aggregator?schema=public',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  merchant: {
    name: process.env.MERCHANT_NAME || 'Universal Merchant Pvt Ltd',
    defaultVpa: process.env.DEFAULT_UPI_VPA || 'merchant@hdfcbank',
    defaultMcc: process.env.DEFAULT_MCC || '5411',
  },
  routing: {
    defaultBank: process.env.DEFAULT_BANK_ROUTING || 'MOCK',
  },
  banks: {
    hdfc: {
      mid: process.env.HDFC_MID || 'HDFC_MERC_100928',
      terminalId: process.env.HDFC_TERMINAL_ID || 'HDFC_TERM_01',
      secretKey: process.env.HDFC_SECRET_KEY || 'hdfc_secret_enc_key_sample_32byte_',
      apiBaseUrl: process.env.HDFC_API_BASE_URL || 'https://api.hdfcbank.com/v1/upi',
    },
    icici: {
      merchantId: process.env.ICICI_MERCHANT_ID || 'ICICI_MERC_99482',
      subMerchantId: process.env.ICICI_SUB_MERCHANT_ID || 'ICICI_SUB_01',
      aesKey: process.env.ICICI_AES_KEY || 'icici_sample_aes_key_32bytes__!',
      apiBaseUrl: process.env.ICICI_API_BASE_URL || 'https://eazypay.icicibank.com/composite/upi',
    },
    axis: {
      merchantId: process.env.AXIS_MERCHANT_ID || 'AXIS_MERC_88301',
      checksumKey: process.env.AXIS_CHECKSUM_KEY || 'axis_sample_checksum_key_64bit',
      apiBaseUrl: process.env.AXIS_API_BASE_URL || 'https://gateway.axisbank.com/direct/upi',
    },
  },
  webhooks: {
    merchantSecret: process.env.MERCHANT_WEBHOOK_SECRET || 'whsec_merchant_hmac_secret_key_998877',
    maxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES || '5', 10),
  },
  idempotency: {
    ttlSeconds: parseInt(process.env.IDEMPOTENCY_TTL_SECONDS || '86400', 10),
  },
};
