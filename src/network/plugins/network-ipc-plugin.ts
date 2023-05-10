import BaseNetworkPlugin from './base/base-network-plugin.js'
import { QueueConsumer } from '../../common/message-bus/index.js'

export const IPC_CHANNEL = '/muon/network/ipc';

type NetworkIpcMessage = {
  method: string,
  params: any
}

export default class NetworkIpcPlugin extends BaseNetworkPlugin {

  bus: QueueConsumer<NetworkIpcMessage>;

  async onStart() {
    this.bus = new QueueConsumer<NetworkIpcMessage>(IPC_CHANNEL);
    this.bus.on("message", this.onMessageReceived.bind(this));
  }

  async onMessageReceived(message, callerInfo){
    const { method, params } = message;

    if(!method || this.listenerCount(`call/${method}`) <= 0){
      throw `Invalid IPC method. ${method}`;
    }
    // @ts-ignore
    return await this.emit(`call/${method}`, params, callerInfo);
  }
}
