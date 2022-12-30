import BaseNetworkPlugin from './base/base-network-plugin.js'
import { QueueConsumer } from '../../common/message-bus/index.js'

export const IPC_CHANNEL = '/muon/network/ipc';

type NetworkIpcMessage = {
  method: string,
  params: any
}

export default class NetworkIpcPlugin extends BaseNetworkPlugin {
  /**
   * @type {QueueConsumer}
   */
  bus: QueueConsumer<NetworkIpcMessage>;

  async onStart() {
    const bus = new QueueConsumer<NetworkIpcMessage>(IPC_CHANNEL);
    bus.on("message", this.onMessageReceived.bind(this));
    this.bus = bus
  }

  async onMessageReceived(message, callerInfo){
    const { method, params } = message;

    if(!method)
      throw "ipc method not defined";

    // @ts-ignore
    if(this.listenerCount(`call/${method}`) > 0){
      // @ts-ignore
      return await this.emit(`call/${method}`, params, callerInfo);
    }
    else {
      throw {message: `ipc method "${method}" is not valid`}
    }
  }
}
