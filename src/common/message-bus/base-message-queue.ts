import BaseMessageBus from './base-message-bus'

module.exports = class BaseMessageQueue extends BaseMessageBus {
  get channelName () {
    return `${this.channelPrefix}/ms/message/queue/${this.busName}`
  }

  getProcessResponseChannel (pid=process.pid) {
    return `${this.channelPrefix}/ms/response/queue/${pid}/${this.busName}`
  }
}
