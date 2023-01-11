import BasePlugin from './base/base-plugin.js'
import { QueueConsumer } from '../../common/message-bus/index.js'

export const IPC_CHANNEL = '/muon/core/ipc';

type CoreIpcMessage = {
  method: string,
  params: any
}

export default class CoreIpcPlugin extends BasePlugin {
  /**
   * @type {QueueConsumer}
   */
  bus:QueueConsumer<CoreIpcMessage>;

  async onStart() {
    const bus = new QueueConsumer<CoreIpcMessage>(IPC_CHANNEL);
    bus.on("message", this.onMessageReceived.bind(this));
    this.bus = bus
  }

  async onMessageReceived(message: CoreIpcMessage, callerInfo){
    const { method, params } = message;

    if(!method)
      throw "ipc method not defined";

    // @ts-ignore
    if(this.listenerCount(`call/${method}`) > 0){
      // console.log("CoreIpcPlugin.onMessageReceived", {method, params, callerInfo})
      // @ts-ignore
      return await this.emit(`call/${method}`, params, callerInfo);
    }
    else {
      throw {message: `ipc method "${method}" is not valid`}
    }
  }
}
