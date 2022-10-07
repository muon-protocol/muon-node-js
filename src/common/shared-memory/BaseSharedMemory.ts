const Events = require('events-async')
import {createClient, RedisClient} from 'redis'
import redisConfig from '../redis-config'
import ISharedData from "./ISharedData";
const {promisify} = require("util");
import {Constructor} from '../types'

export default class BaseSharedMemory<T extends ISharedData> extends Events {

  private elemConstructor
  /**
   * @type {String} - Memory name for transferring message between processes
   */
  private readonly memName
  /**
   * @type {RedisClient} - Redis instance for storing data
   */
  private redis: RedisClient;

  private redisSet: (key: string, val: string) => any;
  private redisGet: (key: string) => Promise<string>;

  constructor(elemConstructor: Constructor<T>, memoryName) {
    super();
    this.elemConstructor = elemConstructor
    this.memName = memoryName;

    const redis = this.createRedisClient();
    this.redisSet = promisify(redis.set).bind(redis)
    this.redisGet = promisify(redis.get).bind(redis)

    redis.on("error", function (error) {
      console.error(`BaseSharedMemory.sendRedis[${memoryName}] error`, error);
    });

    this.redis = redis
  }

  private get baseKeyName() {
    return `muon/shared-mem/${this.memName}/${process.env.SIGN_WALLET_ADDRESS}`
  }

  async set(key: string, data: T): Promise<any> {
    if (!(data instanceof this.elemConstructor))
      throw `BaseSharedMemory.set: type mismatch, expected ${this.elemConstructor.name} but got ${data.constructor.name}`
    // console.log(`BaseSharedMemory.set > ${this.baseKeyName}/${key}`, data.serialize())
    return await this.redisSet(`${this.baseKeyName}/${key}`, data.serialize())
  }

  async get(key: string): Promise<T | void> {
    let result = await this.redisGet(`${this.baseKeyName}/${key}`);
    // console.log(`BaseSharedMemory.get < ${this.baseKeyName}/${key}`, result)
    if (result) {
      return this.elemConstructor.deserialize(result);
    }
  }

  private createRedisClient() {
    return createClient(redisConfig)
  }
}
