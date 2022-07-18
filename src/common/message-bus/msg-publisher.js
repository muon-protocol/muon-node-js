const BaseMessageBus = require('./base-message-bus')

class MessagePublisher extends BaseMessageBus{

  /**
   * @param {Object} message
   * @param {Object} options
   * @returns {Promise<void>}
   */
  async send(message, options={}){
    const wMsg = this.wrapData(message)
    this.sendRedis.publish(this.channelName, JSON.stringify(wMsg));
  }
}

module.exports = MessagePublisher;
