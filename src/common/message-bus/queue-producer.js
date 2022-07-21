const BaseMessageQueue = require('./base-message-queue')
const TimeoutPromise = require('../timeout-promise')
const NodeCache = require('node-cache');

const callCache = new NodeCache({
  stdTTL: 5*60, // Keep call in memory for 5 minutes
  useClones: false,
});

class QueueProducer extends BaseMessageQueue {

  constructor(busName){
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
  send(message, options={}){
    options = {
      timeout: 0,
      timeoutMessage: "Queue request timeout!",
      rawResponse: false,
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
    if(options.pid > -1)
      this.sendRedis.lpush(`${this.channelName}@${options.pid}`, JSON.stringify(wMsg));
    else
      this.sendRedis.lpush(this.channelName, JSON.stringify(wMsg));
    return resultPromise.promise;
  }

  async onResponseReceived(channel, strMessage) {
    const rawResponse = JSON.parse(strMessage);
    let {pid, uid, data: {error=undefined, response=undefined}} = rawResponse;
    let {resultPromise=null, options={}} = callCache.get(uid);
    if(resultPromise) {
      if (!error) {
        resultPromise.resolve(options.rawResponse ? rawResponse : response)
      }
      else {
        // console.log('remote side error', error);
        resultPromise.reject({...error, onRemoteSide: true})
      }
    }
    else{
      console.log(`[${process.pid}] Result promise not found`, rawResponse);
      // TODO: what to do? it may timed out.
    }
  }
}

module.exports = QueueProducer;
