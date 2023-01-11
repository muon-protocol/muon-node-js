import BasePlugin from './base/base-plugin.js'
import * as NetworkIpc from '../../network/ipc.js'
import QueueConsumer from '../../common/message-bus/queue-consumer.js'

export const BROADCAST_CHANNEL = 'core-broadcast';

export type CoreBroadcastMessage = {
  data: {
    channel: string,
    message: any,
  },
  callerInfo: {
    wallet: string,
    peerId: string
  }
}

export default class CoreBroadcastPlugin extends BasePlugin {
  /**
   * @type {QueueConsumer}
   */
  bus: QueueConsumer<CoreBroadcastMessage>;

  async onStart() {
    const bus = new QueueConsumer<CoreBroadcastMessage>(BROADCAST_CHANNEL);
    bus.on("message", this.onBroadcastReceived.bind(this));
    this.bus = bus
  }

  async onBroadcastReceived(broadcast){
    const {data: {channel, message}, callerInfo}  = broadcast;

    if(!channel)
      throw "broadcast channel not defined";

    // if(this.listenerCount(`${channel}`) > 0){
      // @ts-ignore
      return await this.emit(channel, message, callerInfo);
    // }
    // else {
    //   console.error({message: `core.Broadcast.onBroadcastReceived: broadcast channel "${channel}" is not handled`})
    // }
  }

  async subscribe(channel) {
    await NetworkIpc.subscribeToBroadcastChannel(channel);
  }

  async broadcastToChannel(channel, message) {
    if(channel===undefined || message===undefined)
      throw {message: "Broadcast channel/message must be defined"}
    let response = await NetworkIpc.broadcastToChannel(channel, message);
    // TODO: is need to check response is 'Ok' or not?
  }
}
