const BaseMessageQueue = require('./base-message-queue')
import { RemoteCallConfig } from './types'
import TimeoutPromise from '../timeout-promise'
const NodeCache = require('node-cache');

const callCache = new NodeCache({
  stdTTL: 15*60, // Keep call in memory for 15 minutes
  useClones: false,
});

export default class QueueProducer extends BaseMessageQueue {

  constructor(busName: string){
    super(busName)

    this.receiveRedis.subscribe(this.getProcessResponseChannel());
    this.receiveRedis.on("message", this.onResponseReceived.bind(this));
  }

  /**
   * @param event
   * @param options
   * @param options.timeout
   * @param options.timeoutMessage
   * @param options.await - wait to end the event process and then run new one.
   * @returns {Promise<Object>}
   */
  send(message: any, options: RemoteCallConfig={}){
    options = {
      timeout: 0,
      timeoutMessage: "Queue request timeout!",
      pid: -1,
      ...(!!options ? options : {})
    };

    let wMsg = this.wrapData(message)
    let resultPromise = new TimeoutPromise(options.timeout, options.timeoutMessage)
    // this._calls[callId] = remoteResult;
    callCache.set(wMsg.uid, {
      message,
      options,
      resultPromise
    });
    if(options.pid && options.pid > -1)
      this.sendRedis.lpush(`${this.channelName}@${options.pid}`, JSON.stringify(wMsg));
    else
      this.sendRedis.lpush(this.channelName, JSON.stringify(wMsg));
    return resultPromise.promise;
  }

  async onResponseReceived(channel: string, strMessage: string) {
    const rawResponse = JSON.parse(strMessage);
    let {pid, uid, data: {error=undefined, response=undefined}} = rawResponse;
    let {resultPromise=null} = callCache.get(uid) || {};
    if(resultPromise) {
      if (!error) {
        resultPromise.resolve(response)
      }
      else {
        //console.log('QueueProducer.onResponseReceived', rawResponse.data);
        resultPromise.reject({...error, onRemoteSide: true})
      }
    }
    else{
      console.log(`[${process.pid}] Result promise not found`, rawResponse);
      // TODO: what to do? it may timed out.
    }
  }
}
