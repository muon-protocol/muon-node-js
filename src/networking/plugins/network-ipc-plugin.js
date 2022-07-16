const BaseNetworkingPlugin = require('./base/base-network-plugin')
const { QueueConsumer } = require('../../commot/message-bus')

const IPC_CHANNEL = '/muon/network/ipc';

class NetworkIpcPlugin extends BaseNetworkingPlugin {
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
      return await this.emit(`call/${method}`, params, callerInfo);
    }
    else {
      throw {message: `ipc method "${method}" is not valid`}
    }
  }
}

module.exports = NetworkIpcPlugin;
module.exports.IPC_CHANNEL = IPC_CHANNEL
