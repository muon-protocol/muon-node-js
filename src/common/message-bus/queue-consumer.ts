import BaseMessageQueue from './base-message-queue.js'
import { IpcCallConfig } from './types'
import { promisify } from "util"
import { logger } from '@libp2p/logger'

const log = logger('muon:common:msg-bus:q-consumer')

export default class QueueConsumer<MessageType> extends BaseMessageQueue {

  options = {}
  _reading = false;

  constructor(busName: string, options: IpcCallConfig={}) {
    super(busName);

    this.options = options;
  }

  on(eventName: string, listener: (arg:MessageType, {pid: number, uid: string}) => Promise<any>) {
    // @ts-ignore
    super.on(eventName, listener);
    if(!this._reading){
      this._reading = true;
      this.readQueuedMessages();
    }
  }

  async readQueuedMessages() {
    // const blpopAsync = promisify(this.receiveRedis.blpop).bind(this.receiveRedis);
    const sendCommand = promisify(this.receiveRedis.sendCommand).bind(this.receiveRedis);
    while (true) {
      try {
        // let [queue, dataStr] = await blpopAsync(this.channelName, 0)
        let [queue, dataStr] = await sendCommand("BLPOP", [`${this.channelName}@${process.pid}`, this.channelName, '0'])
        this.onMessageReceived(queue, dataStr);
      } catch (e) {
        log.error("%o", e)
      }
    }
  }

  async onMessageReceived(channel: string, strMessage: string) {
    let {pid, uid, data} = JSON.parse(strMessage)
    let response, error;
    try {
      // @ts-ignore
      response = await this.emit("message", data, {pid, uid})
    } catch (e) {
      log.error(`QueueConsumer.onMessageReceived %o`, e);
      if(typeof e === "string")
        e = {message: e};
      error = {
        message: e.message,
        ...e
      };
    }
    this.responseTo(pid, uid, {response, error});
  }

  /**
   * @param {Object} message
   * @param {Object} options
   * @returns {Promise<void>}
   */
  responseTo(pid: number, responseId: number | string, data: any, options: IpcCallConfig={}){
    const receivingProcessChannel = this.getProcessResponseChannel(pid);
    let wMsg = this.wrapData(data, {uid: responseId});
    this.sendRedis.publish(receivingProcessChannel, JSON.stringify(wMsg));
  }
}
