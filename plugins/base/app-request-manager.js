const TimeoutPromise = require('../../core/timeout-promise')

class AppRequestManager{
  requests = {}
  signatures = {}
  promises = {};

  constructor(){
  }

  addRequest(req){
    this.requests[req._id] = req;
  }

  getRequest(_id){
    return this.requests[_id]
  }

  addSignature(reqId, owner, sign){
    if(this.signatures[reqId] === undefined)
      this.signatures[reqId] = {}
    if(this.signatures[reqId][owner] === undefined){
      this.signatures[reqId][owner] = sign
      if(this.isRequestFullFilled(reqId)){
        if(this.promises[reqId])
          this.promises[reqId].resolve(this.signatures[reqId])
      }
    }
  }

  isRequestFullFilled(_id){
    let req = this.requests[_id]
    let sigs = this.signatures[_id]
    return !!sigs && Object.keys(sigs).length >= req.nSign;
  }

  onRequestSignFullFilled(_id){
    if(!this.requests[_id])
      return Promise.reject({message: "RequestManager: request not added to RequestManager"})
    let req = this.requests[_id]
    let sigs = this.signatures[_id]
    if(sigs && Object.keys(sigs).length >= req.nSign){
      return Promise.resolve(sigs)
    }
    else{
      if(this.promises[_id] === undefined)
        this.promises[_id] = new TimeoutPromise(10000, 'Request timed out');
      return this.promises[_id].promise;
    }
  }
}

module.exports = AppRequestManager;
