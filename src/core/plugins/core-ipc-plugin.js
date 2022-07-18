const BasePlugin = require('./base/base-plugin')
const { QueueConsumer } = require('../../common/message-bus')

const IPC_CHANNEL = '/muon/core/ipc';

class CoreIpcPlugin extends BasePlugin {
  /**
   * @type {QueueConsumer}
   */
  bus = null;

  async onInit() {
    const bus = new QueueConsumer(IPC_CHANNEL);
    bus.on("message", this.onMessageReceived.bind(this));
    this.bus = bus
  }

  async onStart() {
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

module.exports = CoreIpcPlugin;
module.exports.IPC_CHANNEL = IPC_CHANNEL
