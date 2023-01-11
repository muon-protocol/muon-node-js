/**
 * ======== Muon Apps request manager ===========
 *
 * AppRequestManager stores all pending request in node-cache for a specific ttl.
 * pending requests will clear after ttl.
 *
 */

import TimeoutPromise from '../../../common/timeout-promise.js'
import NodeCache from 'node-cache'

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

type CacheItem = {
  partnerCount: number,
  requestTimeout: number,
  request: object,
  signatures: object,
  errors: object,
  promise: TimeoutPromise,
}

export default class AppRequestManager{

  constructor(){
  }

  getItem(reqId): CacheItem | undefined{
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

  hasRequest(reqId): boolean{
    return requestCache.has(reqId);
  }

  setPartnerCount(reqId, partnerCount) {
    let item:CacheItem|undefined = this.getItem(reqId);
    if(item) {
      item.partnerCount = partnerCount
    }
  }

  getRequest(reqId): object | undefined{
    const item: CacheItem | undefined = requestCache.get(reqId)
    return !!item ? item.request : undefined
  }

  addSignature(reqId, owner, sign){
    let item: CacheItem | undefined = this.getItem(reqId);
    if(item && item.signatures[owner] === undefined){
      item.signatures[owner] = sign
      if(this.isRequestFullFilled(reqId)){
        if(item.promise)
          item.promise.resolve(item.signatures)
      }
    }
  }

  addError(reqId, owner, error) {
    // console.log('AppRequestManager.addError: request error', reqId, owner, error);
    let item: CacheItem | undefined = this.getItem(reqId);
    if(item && item.errors[owner] === undefined){
      item.errors[owner] = error
      if(this.isRequestFailed(reqId)){
        const req = this.getRequest(reqId)!;
        if(item.promise)
          item.promise.reject({
            message: "Request failed to confirm.",
            data: {
              app: {
                // @ts-ignore
                name: req.app,
                // @ts-ignore
                method: req.method,
                // @ts-ignore
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
    let item: CacheItem|undefined = this.getItem(reqId);
    if(!item)
      return false
    // @ts-ignore
    let {request: {nSign}, signatures: sigs} = item
    return !!sigs && Object.keys(sigs).length >= nSign;
  }

  isRequestFailed(reqId){
    let item: CacheItem | undefined = this.getItem(reqId);
    if(!item)
      return false
    // @ts-ignore
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
    // @ts-ignore
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
