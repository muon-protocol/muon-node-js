import BaseMessageBus from './base-message-bus'

export default class MessageSubscriber extends BaseMessageBus {

  constructor(busName: string) {
    super(busName);

    this.receiveRedis.subscribe(this.channelName);
    this.receiveRedis.on("message", this.onMessageReceived.bind(this));
  }

  async onMessageReceived(channel: string, strMessage: string) {
    let {pid, uid, data} = JSON.parse(strMessage)
    try {
      await this.emit("message", data, {pid, uid})
    } catch (e) {
      console.error("ERROR MessageSubscriber.onMessageReceived", e);
    }
  }
}
