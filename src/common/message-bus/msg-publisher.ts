import BaseMessageBus from './base-message-bus.js'

export type MessageOptions = {
  selfEmit?: Boolean,
}

export default class MessagePublisher extends BaseMessageBus{

  /**
   * @param {Object} message
   * @param {Object} options
   * @returns {Promise<void>}
   */
  async send(message:any, options: MessageOptions){
    const wMsg = this.wrapData(message, {options})
    this.sendRedis.publish(this.channelName, JSON.stringify(wMsg));
  }
}
