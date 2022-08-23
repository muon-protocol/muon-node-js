/**
 * ======== Muon Apps request manager ===========
 *
 * AppRequestManager stores all pending request in node-cache for a specific ttl.
 * pending requests will clear after ttl.
 *
 */

import TimeoutPromise from '../../../common/timeout-promise'
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

export default class AppRequestManager{

  constructor(){
  }

  getItem(reqId){
    return requestCache.get(reqId.toString());
  }

  /**
   * @param req
   * @param options.partnerCount
   * @param options.requestTimeout
   */
  addRequest(req, options={}){
    if(!requestCache.has(req.reqId)){
      requestCache.set(req.reqId, {
        /** options can override items above "...options" */
        partnerCount: Infinity,
        requestTimeout: 40000,

        ...options,

        request: req,
        signatures: {},
        errors: {},
        promise: null,
      });
    }
  }

  hasRequest(reqId){
    return requestCache.has(reqId);
  }

  setPartnerCount(reqId, partnerCount) {
    let item = this.getItem(reqId);
    item.partnerCount = partnerCount
  }

  getRequest(reqId){
    return requestCache.get(reqId).request
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

  addError(reqId, owner, error) {
    // console.log('AppRequestManager.addError: request error', reqId, owner, error);
    let item = this.getItem(reqId);
    if(item.errors[owner] === undefined){
      item.errors[owner] = error
      if(this.isRequestFailed(reqId)){
        const req = this.getRequest(reqId);
        if(item.promise)
          item.promise.reject({
            message: "Request failed to confirm.",
            data: {
              app: {
                name: req.app,
                method: req.method,
                params: req.data.params,
              },
              responses: item.signatures,
              errors: item.errors
            }
          })
      }
    }
  }

  isRequestFullFilled(reqId){
    let item = this.getItem(reqId);
    let {request: {nSign}, signatures: sigs} = item
    return !!sigs && Object.keys(sigs).length >= nSign;
  }

  isRequestFailed(reqId){
    let item = this.getItem(reqId);
    let {request: {nSign}, errors, signatures} = item
    const signCount = Object.keys(signatures).length
    const needMoreSignature = nSign - signCount;
    const failedCount = !!errors ? Object.keys(errors).length : 0;
    const remainingPartners = item.partnerCount - signCount - failedCount;
    // TODO: customize number 2
    return remainingPartners < needMoreSignature || failedCount >= 2;
  }

  onRequestSignFullFilled(reqId){
    let item = this.getItem(reqId);
    if(!item)
      return Promise.reject({message: "RequestManager: request not added to RequestManager"})

    let {request, signatures} = item;
    if(signatures && Object.keys(signatures).length >= request.nSign){
      return Promise.resolve(signatures)
    }
    else{
      if(item.promise === null)
        item.promise = new TimeoutPromise(item.requestTimeout, 'Request timed out');
      return item.promise.promise;
    }
  }
}
