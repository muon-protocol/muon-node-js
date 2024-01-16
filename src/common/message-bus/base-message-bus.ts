import { createClient, RedisClient } from 'redis'
import redisConfig from '../redis-config.js'
import Events from 'events-async'
import {uuid} from '../../utils/helpers.js'
import {MessageBusConfigs} from "./types";

export default class BaseMessageBus extends Events{
  readonly configs: MessageBusConfigs;
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

  constructor(busName: string, configs:MessageBusConfigs={}) {
    super();
    this.busName = busName

    this.configs = {
      ...redisConfig,
      ...configs
    }

    const sendRedis = this.createRedisClient();
    const receiveRedis = this.createRedisClient();

    sendRedis.on("error", function(error) {
      console.error(`BaseMessageBus.sendRedis[${busName}] error`, error);
    });

    receiveRedis.on("error", function(error) {
      console.error(`BaseMessageBus.receiveRedis[${busName}] error`, error);
    });

    this.sendRedis = sendRedis
    this.receiveRedis = receiveRedis
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
    return {pid: process.pid, uid: uuid(), data, ...mix};
  }

  createRedisClient() {
    return createClient(redisConfig)
  }
}
