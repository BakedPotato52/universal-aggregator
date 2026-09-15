import { Redis } from 'ioredis';
import { config } from '../config/index.js';

class RedisClientSingleton {
  private static instance: Redis | null = null;
  private static isConnected = false;

  public static getClient(): Redis {
    if (!RedisClientSingleton.instance) {
      const redis = new Redis(config.redis.url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 3) return null; // Don't hang tests if Redis is offline
          return Math.min(times * 100, 2000);
        },
      });

      redis.on('connect', () => {
        RedisClientSingleton.isConnected = true;
      });

      redis.on('error', () => {
        RedisClientSingleton.isConnected = false;
      });

      RedisClientSingleton.instance = redis;
    }
    return RedisClientSingleton.instance;
  }

  public static async isAvailable(): Promise<boolean> {
    try {
      const client = this.getClient();
      if (client.status === 'ready' || client.status === 'connect') {
        return true;
      }
      await client.connect();
      return true;
    } catch {
      return false;
    }
  }
}

export const getRedisClient = () => RedisClientSingleton.getClient();
export const isRedisAvailable = () => RedisClientSingleton.isAvailable();
