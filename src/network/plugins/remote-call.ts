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
  stdTTL: 6*60,
  useClones: false,
});


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

  handleCall(callId, method, params, callerInfo, options={}, responseStream){
    // @ts-ignore
    return this.emit(`${method}`, params, callerInfo, options)
      .then(result => {
        let response = {
          responseId: callId,
          response: result
        };
        return response
      })
      .catch(error => {
        if(typeof error === "string")
          error = {message: error};
        const {message: ___, ...otherErrorParts} = error;
        let response = {
          responseId: callId,
          error: {
            message: error.message || 'Something went wrong',
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
        throw {message: `Unrecognized sender`}
      }

      let data = JSON.parse(message)

      if('method' in data) {
        let {callId, method, params={}, options} = data;
        return await this.handleCall(callId, method, params, nodeInfo, options, stream);
      }
      else{
        throw {message: `Invalid incoming message`}
      }
    }catch (e) {
      console.error("network.RemoteCall.handleIncomingMessage", e, peerId2Str(peerId), message);
    }
  }

  // async handler1 ({ connection, stream , ...otherOptions}) {
  //   try {
  //     let response;
  //     await pipe(
  //       stream,
  //       async (source) => {
  //         for await (const message of source) {
  //           response = await this.handleIncomingMessage(uint8ArrayToString(message.subarray()), stream, connection.remotePeer)
  //         }
  //       }
  //     )
  //     if(response) {
  //       await pipe(
  //         [this.prepareSendData(response)],
  //         stream
  //       )
  //     }
  //     // stream.close();
  //   } catch (err) {
  //     console.error("network.RemoteCall.handler", err)
  //   }
  //   // finally {
  //   //   // Replies are done on new streams, so let's close this stream so we don't leak it
  //   //   await pipe([], stream)
  //   // }
  // }

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
      log.error("RemoteCall.send failed. peer: %s, error: %O, data: %O", peer.id, err, data)
    }
  }

  async handleSendResponse(signAndMessage, peerId){
    let collateralPlugin:CollateralInfoPlugin = this.network.getPlugin('collateral');
    try {
      let message = signAndMessage.toString()

      let nodeInfo = collateralPlugin.getNodeInfo(peerId2Str(peerId))
      if(!nodeInfo){
        throw {message: `Unrecognized receiver.`};
      }

      let data = JSON.parse(message);

      if('responseId' in data){
        let {responseId, response=undefined, error=undefined} = data;
        // @ts-ignore
        let {resultPromise=null} = callCache.get(responseId);
        if(resultPromise) {
          if (!error)
            resultPromise.resolve(response)
          else {
            resultPromise.reject({...error, onRemoteSide: true})
          }
        }
        else{
          // TODO: what to do? it may timed out.
        }
      }
      else{
        throw {message: `Invalid call response.`}
      }
    }catch (e) {
      log.error("RemoteCall.handleSendResponse failed. err: %O, data: %s",
        e, signAndMessage.toString());
    }
  }

  getPeerStream(peer){
    return this.network.libp2p.dialProtocol(peer.id, [PROTOCOL])
  }

  private getCallExactMethod(method: string, callParams: {method: string}): string {
    return method===this.IpcHandler.RemoteCallExecEndPoint ? callParams.method : method;
  }

  call(peer, method: string, params: any, options: RemoteCallOptions={}){
    let exactMethod = this.getCallExactMethod(method, params);
    log(`Calling peer %s : %s`, peerId2Str(peer.id), exactMethod)
    // TODO: need more check
    if(!peer){
      log.error(`Invalid peerId %s : %s`, peerId2Str(peer.id), exactMethod)
      return Promise.reject({message: `RemoteCall.call: Invalid peerId. method: ${method}`})
    }
    return this.getPeerStream(peer)
      .then(stream => {
        if(!stream) {
          log.error('RemoteCall.call: Invalid stream')
        }
        return this.callConnection(stream, peer, method, params, options)
      })
      .catch(e => {
        log.error(`RemoteCall.call(${peerId2Str(peer.id)}, '${exactMethod}', params) error: %O`, e)
        // @ts-ignore
        if(this.listenerCount('error') > 0) {
          // @ts-ignore
          this.emit({catch: true}, 'error', {peerId: peer.id, method, onRemoteSide: e.onRemoteSide})
            .catch(e => {
              log.error("RemoteCall.call: error handler failed %O", e);
            })
        }
        throw e;
      })
  }

  callConnection(stream, peer, method: string, params: any, options: RemoteCallOptions){
    options = {
      silent: false,
      timeout: 5000, // default timeout
      timeoutMessage: "remoteCall timeout!",
      ...(!!options ? options : {})
    };

    let callId = uuid();
    this.send({callId, method, params, options}, stream, peer)
    let resultPromise = new TimeoutPromise(options.timeout, options.timeoutMessage)

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
    if(options.allowShieldNode)
      this.shieldNodeAllowedMethods[method] = options;
    // @ts-ignore
    super.on(method, handler)
  }

  allowCallByShieldNode(method, options) {
    this.shieldNodeAllowedMethods[method] = options;
  }
}

export default RemoteCall;
