import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { config } from '../config/index.js';

class PrismaSingleton {
  private static instance: PrismaClient | null = null;
  private static pool: pg.Pool | null = null;
  private static lastHealthCheck = 0;
  private static isHealthy = false;

  public static getClient(): PrismaClient {
    if (!PrismaSingleton.instance) {
      const pool = new pg.Pool({
        connectionString: config.database.url,
        max: 10,
        idleTimeoutMillis: 30000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      });

      // Handle idle socket drops gracefully without uncaught exceptions
      pool.on('error', (err: any) => {
        if (
          err?.message &&
          (err.message.includes('timeout') ||
            err.message.includes('Connection terminated') ||
            err.message.includes('closed') ||
            err.message.includes('ECONNRESET'))
        ) {
          // Expected idle client cleanup
          return;
        }
        PrismaSingleton.isHealthy = false;
      });

      const adapter = new PrismaPg(pool);

      PrismaSingleton.pool = pool;
      PrismaSingleton.instance = new PrismaClient({
        adapter,
      });
    }
    return PrismaSingleton.instance;
  }

  public static async isAvailable(): Promise<boolean> {
    const now = Date.now();
    // Cache positive health check for 15 seconds to prevent hammering the pool
    if (PrismaSingleton.isHealthy && now - PrismaSingleton.lastHealthCheck < 15000) {
      return true;
    }

    try {
      const client = this.getClient();
      await client.$queryRaw`SELECT 1`;
      PrismaSingleton.isHealthy = true;
      PrismaSingleton.lastHealthCheck = now;
      return true;
    } catch {
      PrismaSingleton.isHealthy = false;
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
    PrismaSingleton.isHealthy = false;
  }
}

export const getPrismaClient = () => PrismaSingleton.getClient();
export const isDatabaseAvailable = () => PrismaSingleton.isAvailable();
export const disconnectDatabase = () => PrismaSingleton.disconnect();
