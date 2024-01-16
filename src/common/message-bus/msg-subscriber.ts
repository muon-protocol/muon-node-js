import BaseMessageBus from './base-message-bus.js'
import {MessageBusConfigs} from "./types";

export default class MessageSubscriber extends BaseMessageBus {

  constructor(busName: string, configs?:MessageBusConfigs) {
    super(busName, configs);

    this.receiveRedis.subscribe(this.channelName);
    this.receiveRedis.on("message", this.onMessageReceived.bind(this));
  }

  async onMessageReceived(channel: string, strMessage: string) {
    let {pid, uid, data, options} = JSON.parse(strMessage)
    try {
      if(options.selfEmit !== false || pid !== process.pid)
        // @ts-ignore
        await this.emit("message", data, {pid, uid})
    } catch (e) {
      console.error("ERROR MessageSubscriber.onMessageReceived", e);
    }
  }
}
