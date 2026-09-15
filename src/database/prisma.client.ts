import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { config } from '../config/index.js';

class PrismaSingleton {
  private static instance: PrismaClient | null = null;
  private static pool: pg.Pool | null = null;
  private static isConnected = false;

  public static getClient(): PrismaClient {
    if (!PrismaSingleton.instance) {
      const pool = new pg.Pool({
        connectionString: config.database.url,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      pool.on('error', () => {
        PrismaSingleton.isConnected = false;
      });

      const adapter = new PrismaPg(pool);

      PrismaSingleton.pool = pool;
      PrismaSingleton.instance = new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      });
    }
    return PrismaSingleton.instance;
  }

  public static async isAvailable(): Promise<boolean> {
    try {
      const client = this.getClient();
      await client.$queryRaw`SELECT 1`;
      PrismaSingleton.isConnected = true;
      return true;
    } catch {
      PrismaSingleton.isConnected = false;
      return false;
    }
  }

  public static async disconnect(): Promise<void> {
    if (PrismaSingleton.instance) {
      await PrismaSingleton.instance.$disconnect();
    }
    if (PrismaSingleton.pool) {
      await PrismaSingleton.pool.end();
    }
    PrismaSingleton.instance = null;
    PrismaSingleton.pool = null;
    PrismaSingleton.isConnected = false;
  }
}

export const getPrismaClient = () => PrismaSingleton.getClient();
export const isDatabaseAvailable = () => PrismaSingleton.isAvailable();
export const disconnectDatabase = () => PrismaSingleton.disconnect();
