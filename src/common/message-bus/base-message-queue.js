import BaseMessageBus from './base-message-bus'

module.exports = class BaseMessageQueue extends BaseMessageBus {
  get channelName () {
    return `/muon/${process.env.SIGN_WALLET_ADDRESS}/ms/message/queue/${this.busName}`
  }

  getProcessResponseChannel (pid=process.pid) {
    return `/muon/${process.env.SIGN_WALLET_ADDRESS}/ms/response/queue/${pid}/${this.busName}`
  }
}
