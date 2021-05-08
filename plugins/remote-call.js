const BasePlugin = require('./base/base-plugin.js')
const PeerInfo = require('peer-info')
const pipe = require('it-pipe')
const {newCallId} = require('../utils/helpers')

const PROTOCOL = '/muon/remote-call/1.0.0'

class RemoteCall extends BasePlugin {
  _calls = {}

  async onStart() {
    this.muon.libp2p.handle(PROTOCOL, this.handler.bind(this))
  }

  handleCall(callId, method, params, responseStream){
    return this.emit(`remote:${method}`, params)
      .then(result => {
        let response = {
          responseId: callId,
          response: result
        };
        return this.send(response, responseStream)
      })
  }

  async handleIncomingMessage(message, stream){
    try {
      let data = JSON.parse(message)
      if('method' in data) {
        let {callId, method, params={}} = data;
        await this.handleCall(callId, method, params, stream);
      }
      else if('response' in data){
        if('response' in data && 'responseId' in data){
          let {responseId, response} = data;
          let remoteResult = this._calls[responseId]
          remoteResult.resolve(response)
        }
      }
    }catch (e) {
      console.error(e);
    }
  }

  async handler ({ connection, stream }) {
    try {
      await pipe(
        stream,
        async (source) => {
          for await (const message of source) {
            // console.info(`Remote call ${connection.remotePeer.toB58String()}`, message)
            this.handleIncomingMessage(message, stream)
          }
        }
      )
      // console.log('await pipe([], stream)')
      // Replies are done on new streams, so let's close this stream so we don't leak it
      // await pipe([], stream)
    } catch (err) {
      console.error(err)
    }
  }

  async send (data, stream) {
    try {
      await pipe(
        [JSON.stringify(data)],
        stream,
        async (source) => {
          for await (const message of source) {
            this.handleIncomingMessage(message, stream)
          }
        }
      )
    } catch (err) {
      console.error(err)
    }
  }

  call(peer, method, params){

    let callId = newCallId();
    return this.muon.libp2p.dialProtocol(peer.id, [PROTOCOL])
      .then(({stream}) => {
        this.send({callId, method, params}, stream)
        let remoteResult = new RemoteResult()
        this._calls[callId] = remoteResult;
        return remoteResult.promise
      })
  }
}

function RemoteResult() {
  var self = this;
  this.promise = new Promise(function(resolve, reject) {
    self.reject = reject
    self.resolve = resolve
  })
}

module.exports = RemoteCall;
