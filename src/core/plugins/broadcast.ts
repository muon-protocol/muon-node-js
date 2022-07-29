import BasePlugin from './base/base-plugin'
const { call: networkingIpcCall } = require('../../networking/ipc')
const { QueueConsumer } = require('../../common/message-bus')

export const BROADCAST_CHANNEL = 'core-broadcast';

export default class BroadcastPlugin extends BasePlugin {
  /**
   * @type {QueueConsumer}
   */
  bus = null;

  async onStart() {
    const bus = new QueueConsumer(BROADCAST_CHANNEL);
    bus.on("message", this.onBroadcastReceived.bind(this));
    this.bus = bus
  }

  async onBroadcastReceived(broadcast={}){
    // @ts-ignore
    const {data: {channel, message}, callerInfo}  = broadcast;

    if(!channel)
      throw "broadcast channel not defined";

    if(this.listenerCount(`${channel}`) > 0){
      return await this.emit(channel, message, callerInfo);
    }
    else {
      throw {message: `broadcast channel "${channel}" is not handled`}
    }
  }

  async broadcastToChannel(channel, message) {
    if(channel===undefined || message===undefined)
      throw {message: "Broadcast channel/message must be defined"}
    let response = await networkingIpcCall("broadcast-message", {channel, message});
    // TODO: is need to check response is 'Ok' or not?
  }
}
