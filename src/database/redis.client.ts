import { Redis } from 'ioredis';
import { config } from '../config/index.js';

class RedisClientSingleton {
  private static instance: Redis | null = null;
  private static isConnected = false;

  public static getClient(): Redis {
    if (!RedisClientSingleton.instance) {
      const redis = new Redis(config.redis.url, {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        retryStrategy: () => null, // Don't loop endlessly when Redis is not running
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
      if (client.status === 'wait') {
        await client.connect();
      }
      if (client.status === 'ready') {
        await client.ping();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

export const getRedisClient = () => RedisClientSingleton.getClient();
export const isRedisAvailable = () => RedisClientSingleton.isAvailable();
