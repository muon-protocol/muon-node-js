const BasePlugin = require('./base/base-plugin.js')
const pipe = require('it-pipe')
const {newCallId} = require('../utils/helpers')
const uint8ArrayToString = require('uint8arrays/to-string')
const crypto = require('../utils/crypto')

const PROTOCOL = '/muon/remote-call/1.0.0'

class RemoteCall extends BasePlugin {
  _calls = {}

  async onStart() {
    this.muon.libp2p.handle(PROTOCOL, this.handler.bind(this))
  }

  handleCall(callId, method, params, callerWallet, responseStream, peerId){
    return this.emit(`remote:${method}`, params, {wallet: callerWallet, peerId})
      .then(result => {
        let response = {
          responseId: callId,
          response: result
        };
        return this.send(response, responseStream)
      })
      .catch(error => {
        console.error("RemoteCall.handleCall", error)
        let response = {
          responseId: callId,
          error: {
            message: error.message || 'Somethings went wrong'
          }
        };
        return this.send(response, responseStream)
      })
  }

  async handleIncomingMessage(signAndMessage, stream, peerId){
    let collatralPlugin = this.muon.getPlugin('collateral');
    try {
      let [sign, message] = signAndMessage.toString().split('|')
      let sigOwner = crypto.recover(message, sign)
      let data = JSON.parse(message)

      // TODO: filter out unrecognized wallets message.
      let validWallets = collatralPlugin.getWallets()
      if(!validWallets.includes(sigOwner)){
        throw {message: `Unrecognized request owner ${sigOwner}`}
        // let {responseId} = data;
        // let remoteResult = this._calls[responseId]
        // return remoteResult && remoteResult.reject({message: `Unrecognized request owner ${sigOwner}`})
      }

      if('method' in data) {
        let {callId, method, params={}} = data;
        await this.handleCall(callId, method, params, sigOwner, stream, peerId);
      }
      else if('responseId' in data){
        let {responseId, response=undefined, error=undefined} = data;
        let remoteResult = this._calls[responseId]
        if(!error)
          remoteResult.resolve(response)
        else {
          console.log('remote side error', error)
        }
      }
    }catch (e) {
      console.error("RemoteCall.handleIncomingMessage", e);
    }
  }

  async handler ({ connection, stream , ...otherOptions}) {
    try {
      await pipe(
        stream,
        async (source) => {
          for await (const message of source) {
            // console.info(`Remote call ${connection.remotePeer.toB58String()}`, message)
            this.handleIncomingMessage(message, stream, connection.remotePeer)
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

  async send (data, stream, peer) {
    let strData = JSON.stringify(data)
    let signature = crypto.sign(strData)
    try {
      await pipe(
        [`${signature}|${strData}`],
        stream,
        async (source) => {
          for await (const message of source) {
            this.handleIncomingMessage(message, stream, peer)
          }
        }
      )
    } catch (err) {
      console.error("RemoteCall.send", err)
    }
  }

  getPeerCallStream(peer){
    return this.muon.libp2p.dialProtocol(peer.id, [PROTOCOL])
  }

  call(peer, method, params){
    return this.getPeerCallStream(peer)
      .then(({stream}) => {
        if(!stream)
          console.log('no stream call ... ')
        return this.callStream(stream, peer, method, params)
      })
      .catch(e => {
        console.error(`RemoteCall.call(peer, '${method}', params)`, e)
        throw e;
      })
  }

  callStream(stream, peer, method, params){
    let callId = newCallId();
    this.send({callId, method, params}, stream, peer)
    let remoteResult = new RemoteResult()
    this._calls[callId] = remoteResult;
    // TODO: clear this._calls[callID] when remoteResult fullFilled.
    return remoteResult.promise
  }
}

// TODO: replace with TimeoutPromise
function RemoteResult() {
  var self = this;
  this.promise = new Promise(function(resolve, reject) {
    self.reject = reject
    self.resolve = resolve
  })
}

module.exports = RemoteCall;
