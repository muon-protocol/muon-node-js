import BaseNetworkPlugin from './base/base-network-plugin'
const { QueueConsumer } = require('../../common/message-bus')

export const IPC_CHANNEL = '/muon/network/ipc';

export default class NetworkIpcPlugin extends BaseNetworkPlugin {
  /**
   * @type {QueueConsumer}
   */
  bus = null;

  async onStart() {
    const bus = new QueueConsumer(IPC_CHANNEL);
    bus.on("message", this.onMessageReceived.bind(this));
    this.bus = bus
  }

  async onMessageReceived(message, callerInfo){
    const { method, params } = message;

    if(!method)
      throw "ipc method not defined";

    if(this.listenerCount(`call/${method}`) > 0){
      return await this.emit(`call/${method}`, params, callerInfo);
    }
    else {
      throw {message: `ipc method "${method}" is not valid`}
    }
  }
}
