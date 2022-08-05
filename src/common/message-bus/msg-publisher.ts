import BaseMessageBus from './base-message-bus'

export default class MessagePublisher extends BaseMessageBus{

  /**
   * @param {Object} message
   * @param {Object} options
   * @returns {Promise<void>}
   */
  async send(message:any){
    const wMsg = this.wrapData(message)
    this.sendRedis.publish(this.channelName, JSON.stringify(wMsg));
  }
}
