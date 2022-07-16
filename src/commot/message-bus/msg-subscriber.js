const BaseMessageBus = require('./base-message-bus')

class MessageSubscriber extends BaseMessageBus {

  constructor(busName) {
    super(busName);

    this.receiveRedis.subscribe(this.channelName);
    this.receiveRedis.on("message", this.onMessageReceived.bind(this));
  }

  async onMessageReceived(channel, strMessage) {
    let {pid, uid, message} = JSON.parse(strMessage)
    try {
      await this.emit("message", message, {pid, uid})
    } catch (e) {
      console.error("ERROR MessageSubscriber.onMessageReceived", e);
    }
  }
}

module.exports = MessageSubscriber
