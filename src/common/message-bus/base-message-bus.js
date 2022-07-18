const Redis = require('redis');
const redisConfig = require('./redis-config');
const Events = require('events-async')
const {newCallId} = require('@src/utils/helpers')

class BaseMessageBus extends Events{
  /**
   * @type {String} - Bus name for transferring message between processes
   */
  busName = null;
  /**
   * @type {RedisClient} - Redis instance for publishing messages to all other processes
   */
  sendRedis = null;
  /**
   * @type {RedisClient} -
   */
  receiveRedis = null;

  constructor(busName) {
    super();
    this.busName = busName

    this.sendRedis = this.createRedisClient();
    this.receiveRedis = this.createRedisClient();
  }

  get channelName () {
    return `/muon/${process.env.SIGN_WALLET_ADDRESS}/ms/message/bus/${this.busName}`
  }

  getProcessResponseChannel (pid=process.pid) {
    return `/muon/${process.env.SIGN_WALLET_ADDRESS}/ms/response/bus/${pid}/${this.busName}`
  }

  wrapData(data, mix) {
    return {pid: process.pid, uid: newCallId(), data, ...mix};
  }

  createRedisClient() {
    return Redis.createClient(redisConfig)
  }
}

module.exports = BaseMessageBus;
