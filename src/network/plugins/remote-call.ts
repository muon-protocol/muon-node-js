import BaseNetworkPlugin from './base/base-network-plugin.js'
import pipe from 'it-pipe'
import {fromString as uint8ArrayFromString} from 'uint8arrays/from-string'
import {toString as uint8ArrayToString} from 'uint8arrays/to-string';
import {uuid} from '../../utils/helpers.js'
import TimeoutPromise from '../../common/timeout-promise.js'
import CollateralInfoPlugin from "./collateral-info.js";
import {RemoteMethodOptions} from "../../common/types"
import NodeCache from 'node-cache'
import {peerId2Str} from "../utils.js";
import {logger} from '@libp2p/logger'
import NetworkIpcHandler from "./network-ipc-handler";

const log = logger("muon:network:plugins:remote-call")

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

export type RemoteCallOptions = {
  silent?: boolean,
  timeout?: number,
  timeoutMessage?: string,
}

class RemoteCall extends BaseNetworkPlugin {

  private shieldNodeAllowedMethods = {}

  async onStart() {
    this.network.libp2p.handle(
      PROTOCOL,
      this.handler.bind(this),
      {
        maxInboundStreams: 16384,
        maxOutboundStreams: 16384
      }
    )
  }

  private get IpcHandler(): NetworkIpcHandler {
    return this.network.getPlugin('ipc-handler')
  }

  handleCall(callId, method, params, callerInfo, responseStream){
    // @ts-ignore
    return this.emit(`${method}`, params, callerInfo)
      .then(result => {
        let response = {
          responseId: callId,
          response: result
        };
        return response
      })
      .catch(error => {
        //console.error("network.RemoteCall.handleCall", error, {method, params, callerInfo.wallet})
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

  async handleIncomingMessage(message, stream, peerId){
    let collateralPlugin: CollateralInfoPlugin = this.network.getPlugin('collateral');
    try {
      message = message.toString()
      let nodeInfo = collateralPlugin.getNodeInfo(peerId2Str(peerId))
      if(!nodeInfo){
        /** TODO: check shield node allowed methods */
        throw {message: `Unrecognized request owner`}
      }

      let data = JSON.parse(message)

      if('method' in data) {
        let {callId, method, params={}} = data;
        return await this.handleCall(callId, method, params, nodeInfo, stream);
      }
      else{
        // TODO: what to do?
      }
    }catch (e) {
      console.error("network.RemoteCall.handleIncomingMessage", e, peerId2Str(peerId), message);
    }
  }

  async handler1 ({ connection, stream , ...otherOptions}) {
    try {
      let response;
      await pipe(
        stream,
        async (source) => {
          for await (const message of source) {
            response = await this.handleIncomingMessage(uint8ArrayToString(message.subarray()), stream, connection.remotePeer)
          }
        }
      )
      if(response) {
        await pipe(
          [this.prepareSendData(response)],
          stream
        )
      }
      // stream.close();
    } catch (err) {
      console.error("network.RemoteCall.handler", err)
    }
    // finally {
    //   // Replies are done on new streams, so let's close this stream so we don't leak it
    //   await pipe([], stream)
    // }
  }

  async handler ({ connection, stream , ...otherOptions}) {
    const remoteCallInstance = this;
    try {
      let response;
      await pipe(
        stream,
        (source) => {
          return (async function *() {
            for await (const message of source) {
              response = await remoteCallInstance.handleIncomingMessage(uint8ArrayToString(message.subarray()), stream, connection.remotePeer)
              yield remoteCallInstance.prepareSendData(response);
            }
          })();
        },
        stream.sink
      )
      // stream.close();
    } catch (err) {
      console.error("network.RemoteCall.handler", err);
    }
  }

  prepareSendData(data) {
    let strData = JSON.stringify(data)
    // return Buffer.from(strData);
    return uint8ArrayFromString(strData);
  }

  async send (data, stream, peer) {
    try {
      await pipe(
        [this.prepareSendData(data)],
        stream,
        async (source) => {
          for await (const message of source) {
            this.handleSendResponse(uint8ArrayToString(message.subarray()), peer.id)
          }
        }
      )
      //stream.close();
    } catch (err) {
      log.error("send failed peer: %s error: %O", peer.id, err)
    }
    // finally {
    //   // Replies are done on new streams, so let's close this stream so we don't leak it
    //   await pipe([], connection.stream);
    // }
  }

  async handleSendResponse(signAndMessage, peerId){
    let collateralPlugin:CollateralInfoPlugin = this.network.getPlugin('collateral');
    try {
      let message = signAndMessage.toString()

      let nodeInfo = collateralPlugin.getNodeInfo(peerId2Str(peerId))
      if(!nodeInfo){
        throw {message: `Unrecognized message owner`}
        // let {responseId} = data;
        // let remoteResult = this._calls[responseId]
        // return remoteResult && remoteResult.reject({message: `Unrecognized request owner`})
      }

      let data = JSON.parse(message)

      if('responseId' in data){
        let {responseId, response=undefined, error=undefined} = data;
        // let remoteResult = this._calls[responseId]
        // @ts-ignore
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
      log.error("handling send response failed %O", e);
    }
  }

  getPeerStream(peer){
    return this.network.libp2p.dialProtocol(peer.id, [PROTOCOL])
  }

  private getCallExactMethod(method: string, callParams: {method: string}): string {
    return method===this.IpcHandler.RemoteCallExecEndPoint ? callParams.method : method;
  }

  call(peer, method: string, params: any, options: RemoteCallOptions={}){
    log(`calling peer %s : %s`, peerId2Str(peer.id), this.getCallExactMethod(method, params))
    // TODO: need more check
    if(!peer){
      log.error(`missing peer %s : %s`, peerId2Str(peer.id), this.getCallExactMethod(method, params))
      return Promise.reject({message: `network.RemoteCall.call: peer is null for method ${method}`})
    }
    return this.getPeerStream(peer)
      .then(stream => {
        if(!stream) {
          log.error('network.RemoteCall.call: no stream call ... ')
        }
        return this.callConnection(stream, peer, method, params, options)
      })
      .catch(e => {
        let exactMethod = this.getCallExactMethod(method, params);
        log.error(`network.RemoteCall.call(peer, '${exactMethod}', params) peer: ${peerId2Str(peer.id)} %O`, e)

        // @ts-ignore
        if(this.listenerCount('error') > 0) {
          // @ts-ignore
          this.emit({catch: true}, 'error', {peerId: peer.id, method, onRemoteSide: e.onRemoteSide})
            .catch(e => {
              log.error("network.RemoteCall.call: error handler failed %O", e);
            })
        }
        throw e;
      })
  }

  callConnection(stream, peer, method: string, params: any, options: RemoteCallOptions){
    options = {
      silent: false,
      timeout: 5000,
      timeoutMessage: "remoteCall timeout!",
      ...(!!options ? options : {})
    };

    let callId = uuid();
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

  on(method, handler, options: RemoteMethodOptions) {
    // console.log(`network.RemoteCall.on registering call handler`, {method, options})
    if(options.allowShieldNode)
      this.shieldNodeAllowedMethods[method] = options;
    // @ts-ignore
    super.on(method, handler)
  }

  allowCallByShieldNode(method, options) {
    // console.log(`network.RemoteCall.allowCallByShieldNode registering call handler`, {method, options})
    this.shieldNodeAllowedMethods[method] = options;
  }
}

export default RemoteCall;
