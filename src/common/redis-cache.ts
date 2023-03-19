import { createClient, RedisClient } from 'redis'
import redisConfig from './redis-config.js'
import {promisify} from "util";

export class RedisCache {
  /**
   * @type {String} - Base name for storing sub keys
   */
  private readonly baseName: string | null = null;
  /**
   * @type {RedisClient} - Redis instance for storing keys
   */
  private redis: RedisClient;

  private readonly defaultExpire: number;

  /** promisified get/set methods */
  private redisSet: (...args)=>Promise<any>;
  private redisGet: (key: string)=>Promise<any>;

  constructor(baseName: string, defaultExpire?: number) {
    this.baseName = baseName;
    this.defaultExpire = defaultExpire!;

    const redis = createClient(redisConfig)

    redis.on("error", function(error) {
      console.error(`RedisCache[${baseName}] error`, error);
    });

    this.redisSet = promisify(redis.set.bind(redis));
    this.redisGet = promisify(redis.get.bind(redis));
    this.redis = redis
  }

  private get channelPrefix() {
    return `/muon/redis-cache/${process.env.SIGN_WALLET_ADDRESS}/${process.env.PEER_PORT}/${this.baseName}`
  }

  private getRealKey(key: string): string {
    return `${this.channelPrefix}/${key}`
  }

  /**
   * @param key {string}
   * @param value {string}
   * @param expire {number} - Set the specified expire time, in seconds.
   */
  async set(key: string, value: string, expire?: number): Promise<boolean> {
    const _expire = expire || this.defaultExpire;
    if(_expire) {
      return this.redisSet(this.getRealKey(key), value, 'EX', _expire);
    }
    else {
      return this.redisSet(this.getRealKey(key), value);
    }
  }

  async get(key: string): Promise<string> {
    return this.redisGet(this.getRealKey(key));
  }
}
