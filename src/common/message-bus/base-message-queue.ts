import BaseMessageBus from './base-message-bus.js'

export default class BaseMessageQueue extends BaseMessageBus {
  get channelName () {
    return `${this.channelPrefix}/ms/message/queue/${this.busName}`
  }

  getProcessResponseChannel (pid=process.pid) {
    return `${this.channelPrefix}/ms/response/queue/${pid}/${this.busName}`
  }
}
