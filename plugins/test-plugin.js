const BaseApp = require('./base/base-app-plugin')
const Request = require('../gateway/models/Request')
const Signature = require('../gateway/models/Signature')
const NodeUtils = require('../utils/node-utils')
const crypto = require('../utils/crypto')
const {getTimestamp} = require('../utils/helpers')
const {remoteApp, remoteMethod, gatewayMethod} = require('./base/app-decorators')
const all = require('it-all')
const {omit} = require('lodash')

@remoteApp
class TestPlugin extends BaseApp {
  APP_BROADCAST_CHANNEL = 'muon/test_app/request/broadcast'
  APP_NAME = 'test'
  serviceId=null

  constructor(...args) {
    super(...args);
  }

  async onStart(){
    super.onStart();
    // this.initializeService()
  }

  async initializeService(){
    let serviceCID = await NodeUtils.common.strToCID(this.APP_BROADCAST_CHANNEL)
    await this.muon.libp2p.contentRouting.provide(serviceCID)
    this.serviceId = serviceCID
    console.log({serviceCID: serviceCID.toString()})
  }

  @gatewayMethod('status')
  async getStatus(data){
    let providers = await all(this.muon.libp2p.contentRouting.findProviders(this.serviceId, {timeout: 5000}))
    return {
      serviceId: this.serviceId.toString(),
      providers: providers.map(p => p.id.toB58String()),
    }
  }

  @gatewayMethod('sign')
  async signRequest(data){
    let number = 1 + Math.random()

    let startedAt = getTimestamp();
    let newRequest = new Request({
      app: 'test',
      method: 'sign',
      owner: process.env.SIGN_WALLET_ADDRESS,
      peerId: process.env.PEER_ID,
      data: {
        number
      },
      startedAt,
    })

    await newRequest.save()
    let sign = {
      request: newRequest._id,
      owner: process.env.SIGN_WALLET_ADDRESS,
      timestamp: getTimestamp(),
      data: {
        number
      },
      signature: crypto.signString(`${number}`)
    };
    (new Signature(sign)).save()

    this.broadcastNewRequest(newRequest)

    let [confirmed, signatures] = await this.isOtherNodesConfirmed(newRequest, parseInt(process.env.NUM_SIGN_TO_CONFIRM))

    if(confirmed){
      newRequest['confirmedAt'] = getTimestamp()
    }

    let requestData = {
      confirmed,
      ...omit(newRequest._doc, ['__v']),
      signatures,
    }

    if (confirmed) {
      newRequest.save()
      await this.emit('request-signed', requestData)
    }

    return {
      cid: (await NodeUtils.common.strToCID(JSON.stringify(requestData))).toString(),
      ...requestData
    }
  }

  // @remoteMethod('wantSignature')
  // async wantSignature(data){
  //   console.log('TestPlugin.wantSignature', data)
  //   return {test: 'ok'}
  // }

  /**
   * ======================================
   */

  recoverSignature(request, sig) {
    return crypto.recoverStringSignature(`${request.data.number}`, sig.signature)
  }

  async processRemoteRequest(request) {
    console.log({request})
    let {number: reqNumber} = request['data']
    if (reqNumber<1 || reqNumber>2) {
      throw {"message": "Invalid number"}
    }

    let number = 1 + Math.random();

    let sign = {
      request: request._id,
      owner: process.env.SIGN_WALLET_ADDRESS,
      timestamp: getTimestamp(),
      data: {number},
      signature: crypto.signString(`${request.data.number}`)
    }
    return sign
  }
}

module.exports = TestPlugin;
