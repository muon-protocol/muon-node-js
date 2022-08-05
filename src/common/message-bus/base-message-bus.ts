import { createClient, RedisClient } from 'redis'
import redisConfig from './redis-config'
const Events = require('events-async')
const {newCallId} = require('../../utils/helpers')

export default class BaseMessageBus extends Events{
  /**
   * @type {String} - Bus name for transferring message between processes
   */
  busName: string | null = null;
  /**
   * @type {RedisClient} - Redis instance for publishing messages to all other processes
   */
  sendRedis: RedisClient;
  /**
   * @type {RedisClient} -
   */
  receiveRedis: RedisClient;

  constructor(busName: string) {
    super();
    this.busName = busName

    this.sendRedis = this.createRedisClient();
    this.receiveRedis = this.createRedisClient();
  }

  get channelPrefix() {
    return `/muon/${process.env.SIGN_WALLET_ADDRESS}/${process.env.PEER_PORT}`
  }

  get channelName () {
    return `${this.channelPrefix}/ms/message/bus/${this.busName}`
  }

  getProcessResponseChannel (pid=process.pid) {
    return `${this.channelPrefix}/ms/response/bus/${pid}/${this.busName}`
  }

  wrapData(data: any, mix?: object) {
    return {pid: process.pid, uid: newCallId(), data, ...mix};
  }

  createRedisClient() {
    return createClient(redisConfig)
  }
}
