import BasePlugin from './base/base-plugin'
const { QueueConsumer } = require('../../common/message-bus')

export const IPC_CHANNEL = '/muon/core/ipc';

export default class CoreIpcPlugin extends BasePlugin {
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
      // console.log("CoreIpcPlugin.onMessageReceived", {method, params, callerInfo})
      return await this.emit(`call/${method}`, params, callerInfo);
    }
    else {
      throw {message: `ipc method "${method}" is not valid`}
    }
  }
}
