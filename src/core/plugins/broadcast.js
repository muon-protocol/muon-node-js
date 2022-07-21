const BasePlugin = require('./base/base-plugin')
const { call: networkingIpcCall } = require('../../networking/ipc')
const { QueueConsumer } = require('../../common/message-bus')

const BROADCAST_CHANNEL = 'core-broadcast';

class BroadcastPlugin extends BasePlugin {
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
    const {data: {channel, message}, callerInfo}  = broadcast;

    if(!channel)
      throw "broadcast channel not defined";

    if(this.listenerCount(`${channel}`) > 0){
      return await this.emit(channel, message, callerInfo);
    }
    else {
      throw {message: `broadcast channel "${method}" is not handled`}
    }
  }

  async broadcast(channel, message) {
    if(channel===undefined || message===undefined)
      throw {message: "Broadcast channel/message must be defined"}
    let response = await networkingIpcCall("broadcast-message", {channel, message});
    // TODO: is need to check response is 'Ok' or not?
  }
}

module.exports = BroadcastPlugin;
module.exports.BROADCAST_CHANNEL = BROADCAST_CHANNEL;
