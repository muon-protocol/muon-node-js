/**
 * ======== Muon Apps request manager ===========
 *
 * AppRequestManager stores all pending request in node-cache for a specific ttl.
 * pending requests will clear after ttl.
 *
 */

const TimeoutPromise = require('../../core/timeout-promise')
const NodeCache = require('node-cache');

const requestCache = new NodeCache({
  /**
   * stdTTL: (default: 0) the standard ttl as number in seconds for every generated cache element
   */
  // stdTTL: 6*3600, // 6 hours
  stdTTL: 30*60, // 30 minutes

  /**
   * useClones: (default: true) en/disable cloning of variables.
   * If true you'll get a copy of the cached variable.
   * If false you'll save and get just the reference.
   */
  useClones: false,
});

class AppRequestManager{

  constructor(){
  }

  getItem(reqId){
    return requestCache.get(reqId.toString());
  }

  addRequest(req){
    if(!requestCache.has(req._id)){
      requestCache.set(req._id.toString(), {
        request: req,
        signatures: {},
        promise: null,
      });
    }
  }

  getRequest(_id){
    return requestCache.get(_id.toString()).request
  }

  addSignature(reqId, owner, sign){
    let item = this.getItem(reqId);
    if(item.signatures[owner] === undefined){
      item.signatures[owner] = sign
      if(this.isRequestFullFilled(reqId)){
        if(item.promise)
          item.promise.resolve(item.signatures)
      }
    }
  }

  isRequestFullFilled(_id){
    let item = this.getItem(_id);
    let {request: {nSign}, signatures: sigs} = item
    return !!sigs && Object.keys(sigs).length >= nSign;
  }

  onRequestSignFullFilled(_id){
    let item = this.getItem(_id);
    if(!item)
      return Promise.reject({message: "RequestManager: request not added to RequestManager"})

    let {request, signatures} = item;
    if(signatures && Object.keys(signatures).length >= request.nSign){
      return Promise.resolve(signatures)
    }
    else{
      if(item.promise === null)
        item.promise = new TimeoutPromise(10000, 'Request timed out');
      return item.promise.promise;
    }
  }
}

module.exports = AppRequestManager;
