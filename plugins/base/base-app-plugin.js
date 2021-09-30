const BasePlugin = require('./base-plugin')
const Request = require('../../gateway/models/Request')
const Signature = require('../../gateway/models/Signature')
const PeerId = require('peer-id')
const uint8ArrayFromString = require('uint8arrays/from-string')
const {makeAppDependency} = require('./app-dependencies')
const uint8ArrayToString = require('uint8arrays/to-string')
const { getTimestamp, timeout } = require('../../utils/helpers')
const crypto = require('../../utils/crypto')
const { omit } = require('lodash')
const TimeoutPromise = require('../../core/timeout-promise')

const clone = (obj) => JSON.parse(JSON.stringify(obj))

class RequestManager{
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

class BaseAppPlugin extends BasePlugin {
  APP_NAME = null
  requestManager = new RequestManager();

  constructor(...args) {
    super(...args)

    /**
     * This is abstract class, so "new BaseAppPlugin()" is not allowed
     */
    // if (new.target === BaseAppPlugin) {
    //   throw new TypeError("Cannot construct abstract BaseAppPlugin instances directly");
    // }

  }

  async onInit() {
    if(this.dependencies){
      this.initializeDependencies();
    }
    if(this.onAppInit)
      this.onAppInit();
  }

  initializeDependencies() {
    this.dependencies.map(key => {
      this[key] = makeAppDependency(this, key);
    })
  }

  async onStart() {
    // console.log(`onStart app[${this.APP_NAME}] ...`, this.constructor)
    /**
     * Subscribe to app broadcast channel
     */
    let broadcastChannel = this.getBroadcastChannel()
    if (broadcastChannel) {
      await this.muon.libp2p.pubsub.subscribe(broadcastChannel)
      this.muon.libp2p.pubsub.on(
        broadcastChannel,
        this.__onBroadcastReceived.bind(this)
      )
    }
    /**
     * Remote call handlers
     */
    this.muon
      .getPlugin('remote-call')
      .on(
        `remote:app-${this.APP_NAME}-get-request`,
        this.__onRemoteWantRequest.bind(this)
      )
    this.muon
      .getPlugin('remote-call')
      .on(
        `remote:app-${this.APP_NAME}-request-sign`,
        this.__onRemoteSignRequest.bind(this)
      )
    this.muon
      .getPlugin('gateway-interface')
      .registerAppCall(
        this.APP_NAME,
        'request',
        this.__onRequestArrived.bind(this)
      )
  }

  getBroadcastChannel() {
    return this.APP_NAME ? `muon/${this.APP_NAME}/request/broadcast` : null
  }

  async __onRequestArrived(method, params, nSign) {
    let t0 = Date.now()
    let startedAt = getTimestamp()
    nSign = !!nSign
      ? parseInt(nSign)
      : parseInt(process.env.NUM_SIGN_TO_CONFIRM)

    if(this.getNSign)
      nSign = this.getNSign(nSign)

    let newRequest = new Request({
      app: this.APP_NAME,
      method: method,
      nSign,
      owner: process.env.SIGN_WALLET_ADDRESS,
      peerId: process.env.PEER_ID,
      data: {
        params
      },
      startedAt
    })
    let t1= Date.now()

    // user apps cannot override _onArrive method
    if(this._onArrive){
      newRequest.data.init = await this._onArrive(newRequest);
    }
    // user apps can override onArrive method
    if(this.onArrive){
      newRequest.data.init = {
        ... newRequest.data.init,
        ... await this.onArrive(clone(newRequest))
      };
    }
    let t2 = Date.now()

    let result = await this.onRequest(clone(newRequest))
    newRequest.data.result = result
    let t3 = Date.now()

    let resultHash = this.hashRequestResult(newRequest, result)
    let memWrite = this.getMemWrite(newRequest, result)
    if (!!memWrite) {
      newRequest.data.memWrite = memWrite
    }

    this.requestManager.addRequest(newRequest);

    // await newRequest.save()

    let sign = this.makeSignature(newRequest, result, resultHash)
    if (!!memWrite) {
      sign.memWriteSignature = memWrite.signature
    }
    this.requestManager.addSignature(newRequest._id, sign.owner, sign);
    // new Signature(sign).save()

    this.broadcastNewRequest(newRequest)
    let t4 = Date.now()

    let [confirmed, signatures] = await this.isOtherNodesConfirmed(newRequest)
    let t5 = Date.now()

    console.log('base-app-plugin.__onRequestArrived',{
      t1: t1-t0,
      t2: t2-t1,
      t3: t3-t2,
      t4: t4-t3,
      t5: t5-t4,
      '*': t5-t0
    })

    if (confirmed) {
      newRequest['confirmedAt'] = getTimestamp()
    }

    let requestData = {
      confirmed,
      ...omit(newRequest._doc, [
        '__v'
        // 'data.memWrite'
      ]),
      signatures
    }

    if (confirmed) {
      newRequest.save()
      this.muon.getPlugin('memory').writeAppMem(requestData)
    }

    return requestData
  }

  /**
   * This method should response a Signature model object
   * @param request
   * @returns {Promise<void>} >> Response object
   */
  async processRemoteRequest(request) {
    let result = await this.onRequest(clone(request))

    let hash1 = await this.hashRequestResult(request, request.data.result)
    let hash2 = await this.hashRequestResult(request, result)

    if (hash1 === hash2) {
      let memWrite = this.getMemWrite(request, result)
      return [this.makeSignature(request, result, hash2), memWrite]
    } else {
      console.log({hash1, hash2})
      throw { message: 'Request not confirmed' }
    }
  }

  getMemWrite(request, result) {
    if (this.hasOwnProperty('onMemWrite')) {
      let memPlugin = this.muon.getPlugin('memory');
      let timestamp = request.startedAt
      let nSign = request.nSign
      let appMem = this.onMemWrite(request, result)
      if (!appMem) return
      let { ttl, data } = appMem

      let memWrite = {
        type: 'app',
        owner: this.APP_NAME,
        timestamp,
        ttl,
        nSign,
        data,
      }

      let hash = memPlugin.hashMemWrite(memWrite);
      let signature = crypto.sign(hash)
      return { ...memWrite, hash, signature }
    }
  }

  async memRead(query, options) {
    return this.muon.getPlugin('memory').readAppMem(this.APP_NAME, query, options)
  }

  async writeNodeMem(data, ttl=0) {
    this.muon.getPlugin('memory').writeNodeMem({ttl, data})
  }

  async readNodeMem(query, options) {
    return this.muon.getPlugin('memory').readNodeMem(query, options)
  }

  async isOtherNodesConfirmed(newRequest) {

    let signers = await this.requestManager.onRequestSignFullFilled(newRequest._id)

    let owners = Object.keys(signers)
    let allSignatures = owners.map(w => signers[w]);

    let confirmed = Object.keys(signers).length >= newRequest.nSign

    return [
      confirmed,
      allSignatures
        .map((sig) => ({
          owner: sig['owner'],
          timestamp: sig['timestamp'],
          result: sig['data'],
          signature: sig['signature'],
          memWriteSignature: sig['memWriteSignature']
        }))
    ]
  }

  async isOtherNodesConfirmed0(newRequest) {
    let secondsToCheck = 0
    let confirmed = false
    let allSignatures = []
    let signers = {}

    while (!confirmed && secondsToCheck < 5) {
      await timeout(250)
      allSignatures = await Signature.find({ request: newRequest._id })
      signers = {}
      for (let sig of allSignatures) {
        let sigOwner = this.recoverSignature(newRequest, sig)
        if (!!sigOwner && sigOwner !== sig['owner']) continue

        signers[sigOwner] = true
      }

      if (Object.keys(signers).length >= newRequest.nSign) {
        confirmed = true
      }
      secondsToCheck += 0.25
    }

    return [
      confirmed,
      allSignatures
        .filter((sig) => Object.keys(signers).includes(sig['owner']))
        .map((sig) => ({
          owner: sig['owner'],
          timestamp: sig['timestamp'],
          result: sig['data'],
          signature: sig['signature'],
          memWriteSignature: sig['memWriteSignature']
        }))
    ]
  }

  async __onBroadcastReceived(msg) {
    let remoteCall = this.muon.getPlugin('remote-call')
    try {
      let data = JSON.parse(uint8ArrayToString(msg.data))
      if (data && data.type === 'new_request') {
        let peerId = PeerId.createFromCID(data.peerId)
        let peer = await this.muon.libp2p.peerRouting.findPeer(peerId)
        let request = await remoteCall.call(
          peer,
          `app-${this.APP_NAME}-get-request`,
          { _id: data._id }
        )
        if (request) {
          // console.log(`request info found: `, request)
          let [sign, memWrite] = await this.processRemoteRequest(request)
          await remoteCall.call(peer, `app-${this.APP_NAME}-request-sign`, {
            sign,
            memWrite
          })
        } else {
          // console.log(`request info not found "${data.id}"`)
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  /**
   *
   * @param request
   * @returns {Promise<*[isVerified, expectedResult, actualResult]>}
   */
  async isVerifiedRequest(request) {
    let actualResult
    try {
      let {
        data: { result }
      } = request
      actualResult = await this.onRequest(clone(request))
      let verified = false
      if (actualResult) {
        let hash1 = this.hashRequestResult(request, result)
        let hash2 = this.hashRequestResult(request, actualResult)
        verified = hash1 === hash2
      }
      return [verified, request.data.result, actualResult]
    } catch (e) {
      return [false, request.data.result, actualResult]
    }
  }

  recoverSignature(request, sign) {
    let hash = this.hashRequestResult(request, sign.data)
    return crypto.recover(hash, sign.signature)
  }

  broadcastNewRequest(request) {
    let broadcastChannel = this.getBroadcastChannel()
    if (!broadcastChannel) return
    let data = {
      type: 'new_request',
      peerId: process.env.PEER_ID,
      _id: request._id
    }
    let dataStr = JSON.stringify(data)
    this.muon.libp2p.pubsub.publish(
      broadcastChannel,
      uint8ArrayFromString(dataStr)
    )
  }

  remoteMethodEndpoint(title) {
    return `app-${this.APP_NAME}-${title}`
  }

  remoteCall(peer, methodName, data) {
    let remoteCall = this.muon.getPlugin('remote-call')
    let remoteMethodEndpoint = this.remoteMethodEndpoint(methodName)
    return remoteCall.call(peer, remoteMethodEndpoint, data)
  }

  /**
   * hash parameters that smart contract need it.
   *
   * @param request
   * @param result
   * @returns {sha3 hash of parameters}
   */
  hashRequestResult(request, result) {
    return null
  }

  makeSignature(request, result, resultHash) {
    let signTimestamp = getTimestamp()
    let signature = crypto.sign(resultHash)
    return {
      request: request._id,
      owner: process.env.SIGN_WALLET_ADDRESS,
      timestamp: signTimestamp,
      data: result,
      signature
    }
  }

  /**
   * Remote call handlers
   * This methods will call from remote peer
   */

  async __onRemoteWantRequest(data) {
    try {
      // console.log('RemoteCall.getRequestData', data)
      // let req = await Request.findOne({_id: data._id})
      let req = this.requestManager.getRequest(data._id)
      return req
    }catch (e) {
      console.error(e);
    }
  }

  async __onRemoteSignRequest(data = {}) {
    // console.log('BaseAppPlugin.__onRemoteSignRequest', data)
    try {
      let {sign, memWrite} = data;
      // let request = await Request.findOne({_id: sign.request})
      let request = this.requestManager.getRequest(sign.request)
      if (request) {
        // TODO: check response similarity
        let signer = this.recoverSignature(request, sign)
        if (signer && signer === sign.owner) {
          if (!!memWrite) {
            // TODO: validate memWright signature
            sign.memWriteSignature = memWrite.signature
          }
          this.requestManager.addSignature(request._id, sign.owner, sign)
          // let newSignature = new Signature(sign)
          // await newSignature.save()
        } else {
          console.log('signature mismatch', {
            request: request._id,
            signer,
            sigOwner: sign.owner
          })
        }
      }
      else{
        console.log(`BaseAppPlugin.__onRemoteSignRequest >> Request not found id:${sign.request}`)
      }
    }
    catch (e) {
      console.error('BaseAppPlugin.__onRemoteSignRequest', e);
    }
  }
}

module.exports = BaseAppPlugin
