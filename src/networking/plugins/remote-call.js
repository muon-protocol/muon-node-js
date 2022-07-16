const BaseNetworkingPlugin = require('./base/base-network-plugin')
const pipe = require('it-pipe')
const {newCallId} = require('../../utils/helpers')
const TimeoutPromise = require('../../core/timeout-promise')
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

const PROTOCOL = '/muon/network/remote-call/1.0.0'

class RemoteCall extends BaseNetworkingPlugin {

  async onStart() {
    this.network.libp2p.handle(PROTOCOL, this.handler.bind(this))
  }

  handleCall(callId, method, params, callerWallet, responseStream, peerId){
    return this.emit(`${method}`, params, {wallet: callerWallet, peerId})
      .then(result => {
        let response = {
          responseId: callId,
          response: result
        };
        return response
      })
      .catch(error => {
        console.error("RemoteCall.handleCall", error)
        if(typeof error === "string")
          error = {message: error};
        const {message: ___, ...otherErrorParts} = error;
        let response = {
          responseId: callId,
          error: {
            message: error.message || 'Somethings went wrong',
            ...otherErrorParts
          }
        };
        return response
      })
  }

  async handleIncomingMessage(signAndMessage, stream, peerId){
    let collateralPlugin = this.network.getPlugin('collateral');
    try {
      let message = signAndMessage.toString()
      let peerWallet = collateralPlugin.getPeerWallet(peerId)
      if(!peerWallet){
        throw {message: `Unrecognized request owner`}
      }

      let data = JSON.parse(message)

      if('method' in data) {
        let {callId, method, params={}} = data;
        return await this.handleCall(callId, method, params, peerWallet, stream, peerId);
      }
      else{
        // TODO: what to do?
      }
    }catch (e) {
      console.error("RemoteCall.handleIncomingMessage", e);
    }
  }

  async handler ({ connection, stream , ...otherOptions}) {
    try {
      let response;
      await pipe(
        stream,
        async (source) => {
          for await (const message of source) {
            response = await this.handleIncomingMessage(message, stream, connection.remotePeer)
          }
        }
      )
      if(response) {
        await pipe([this.prepareSendData(response)], stream)
      }
    } catch (err) {
      console.error("RemoteCall.handler", err)
    }
    // finally {
    //   // Replies are done on new streams, so let's close this stream so we don't leak it
    //   await pipe([], stream)
    // }
  }

  prepareSendData(data) {
    let strData = JSON.stringify(data)
    // let signature = crypto.sign(strData)
    // return Buffer.from(`${signature}|${strData}`);
    return Buffer.from(strData);
  }

  async send (data, connection, peer) {
    try {
      await pipe(
        [this.prepareSendData(data)],
        connection.stream,
        async (source) => {
          for await (const message of source) {
            await this.handleSendResponse(message, peer.id)
          }
        }
      )
    } catch (err) {
      console.log('=============================');
      console.log(peer)
      console.log('=============================');
      console.error("RemoteCall.send", err)
    }
    // finally {
    //   // Replies are done on new streams, so let's close this stream so we don't leak it
    //   await pipe([], connection.stream);
    // }
  }

  async handleSendResponse(signAndMessage, peerId){
    let collateralPlugin = this.network.getPlugin('collateral');
    try {
      let message = signAndMessage.toString()

      let peerWallet = collateralPlugin.getPeerWallet(peerId)
      if(!peerWallet){
        throw {message: `Unrecognized message owner`}
        // let {responseId} = data;
        // let remoteResult = this._calls[responseId]
        // return remoteResult && remoteResult.reject({message: `Unrecognized request owner`})
      }

      let data = JSON.parse(message)

      if('responseId' in data){
        let {responseId, response=undefined, error=undefined} = data;
        // let remoteResult = this._calls[responseId]
        let {resultPromise=null} = callCache.get(responseId);
        if(resultPromise) {
          if (!error)
            resultPromise.resolve(response)
          else {
            // console.log('remote side error', error);
            resultPromise.reject({...error, onRemoteSide: true})
          }
        }
        else{
          // TODO: what to do? it may timed out.
        }
      }
      else{
        // TODO: what to do? it may timed out.
      }
    }catch (e) {
      console.error("RemoteCall.handleSendResponse", e);
    }
  }

  getPeerConnection(peer){
    return this.network.libp2p.dialProtocol(peer.id, [PROTOCOL])
  }

  call(peer, method, params, options={}){
    // TODO: need more check
    if(!peer){
      return Promise.reject({message: `RemoteCall.call: peer is null for method ${method}`})
    }
    return this.getPeerConnection(peer)
      .then(connection => {
        if(!connection?.stream)
          console.log('no stream call ... ')
        return this.callConnection(connection, peer, method, params, options)
      })
      .catch(e => {
        if(!options?.silent) {
          console.error(`RemoteCall.call(peer, '${method}', params)`, `peer: ${peer.id._idB58String}`, e)
        }
        this.emit("error", {peerId: peer.id, method, onRemoteSide: e.onRemoteSide})
          .catch(e => {
            console.log("RemoteCall.call.error handler failed", e)
          })
        throw e;
      })
  }

  callConnection(connection, peer, method, params, options){
    options = {
      silent: false,
      timeout: 5000,
      timeoutMessage: "remoteCall timeout!",
      ...(!!options ? options : {})
    };

    let callId = newCallId();
    this.send({callId, method, params}, connection, peer)
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
}

module.exports = RemoteCall;
