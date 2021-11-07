const BasePlugin = require('./base/base-plugin.js')
const pipe = require('it-pipe')
const {newCallId} = require('../utils/helpers')
const TimeoutPromise = require('../core/timeout-promise')
const crypto = require('../utils/crypto')
const NodeCache = require('node-cache');

const callCache = new NodeCache({
  stdTTL: 6*60, // Keep call in memory for 6 minutes
  // stdTTL: 10, // Keep call in memory for 10 seconds
  // /**
  //  * (default: 600)
  //  * The period in seconds, as a number, used for the automatic delete check interval.
  //  * 0 = no periodic check.
  //  */
  // checkperiod: 5,
  useClones: false,
});

// callCache.on( "set", function( key, value ){
//   console.log(`adding remote-call [${key}]`)
// });
// callCache.on( "del", function( key, value ){
  // console.log(`deleting remote-call [${key}] isFulFilled: ${value.resultPromise.isFulfilled}`, value.method)
  // let {resultPromise} = value
  // if(!resultPromise.isFulfilled){
  //   resultPromise.reject({message: 'remote-call timed out.'})
  // }
// });

const PROTOCOL = '/muon/remote-call/1.0.0'

class RemoteCall extends BasePlugin {

  _remoteMethodOptions = {}

  async onStart() {
    this.muon.libp2p.handle(PROTOCOL, this.handler.bind(this))
    this.collateralPlugin = this.muon.getPlugin('collateral');
  }

  hasPermission(method, callerInfo) {
    let {wallet} = callerInfo;
    let options = this._remoteMethodOptions[method] || {};
    if(!this.collateralPlugin.groupWallets[wallet]){
      if(!options.allowFromOtherGroups || !this.collateralPlugin.otherGroupWallets[wallet]){
          return false
      }
    }
    return true;
  }

  checkPermissions(method, callerInfo){
    // TODO: merge with broadcast sender validation
    if(this.hasPermission(method, callerInfo))
      return Promise.resolve(true)
    else
      return Promise.reject({message: `Permission denied for request "${method}" from ${callerInfo.wallet}`})
  }

  handleCall(method, params, callId, responseStream, callerInfo){
    // console.log('=========== RemoteCall.handleCall', method)
    return this.checkPermissions(method, callerInfo).then(() => {
      return this.emit(`remote:${method}`, params, callerInfo)
    })
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

  handleBroadcast(method, params, callerWallet) {
    let callerInfo = {wallet: callerWallet}
    return this.checkPermissions(method, callerInfo).then(() => {
      return this.emit(`remote:${method}`, params, callerInfo)
    })
      .catch(error => {
        console.error("RemoteCall.handleBroadcast", error)
      })
  }

  async handleIncomingMessage(signAndMessage, stream, peerId){
    try {
      let [sign, message] = signAndMessage.toString().split('|')
      let sigOwner = crypto.recover(message, sign)
      let data = JSON.parse(message)

      if('method' in data) {
        let {callId, method, params={}} = data;
        await this.handleCall(method, params, callId, stream, {wallet: sigOwner, peerId});
      }
      else if('responseId' in data){
        let {responseId, response=undefined, error=undefined} = data;
        // let remoteResult = this._calls[responseId]
        let {resultPromise=null} = callCache.get(responseId);
        if(resultPromise) {
          if (!error)
            resultPromise.resolve(response)
          else {
            console.log('remote side error', error);
            resultPromise.reject(error)
          }
        }
        else{
          // TODO: what to do? it may timed out.
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

  call(peer, method, params, options){
    return this.getPeerCallStream(peer)
      .then(({stream}) => {
        if(!stream)
          console.log('no stream call ... ')
        return this.callStream(stream, peer, method, params, options)
      })
      .catch(e => {
        console.error(`RemoteCall.call(peer, '${method}', params)`, e)
        throw e;
      })
  }

  callStream(stream, peer, method, params, options){
    options = {
      timeout: 5000,
      timeoutMessage: "remoteCall timeout!",
      ...(!!options ? options : {})
    };

    let callId = newCallId();
    this.send({callId, method, params}, stream, peer)
    let resultPromise = new TimeoutPromise(options.timeout, options.timeoutMessage)
    // this._calls[callId] = remoteResult;
    callCache.set(callId, {
      method,
      params,
      peer,
      options,
      resultPromise
    });
    return resultPromise.promise;
  }

  on(title, callback, options={}) {
    this._remoteMethodOptions[title] = options
    super.on(`remote:${title}`, callback);
  }

  hasMethodHandler(method) {
    return this.listenerCount(`remote:${method}`) > 0;
  }
}

module.exports = RemoteCall;
