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
  serviceProviders = []

  constructor(...args) {
    super(...args);
  }

  async onStart(){
    super.onStart();
    this.initializeService()
  }

  async updatePeerList(){
    console.log('TestPlugin updating peer list ...')
    let providers = await all(this.muon.libp2p.contentRouting.findProviders(this.serviceId, {timeout: 5000}))
    let otherProviders = providers.filter(({id}) => (id._idB58String !== process.env.PEER_ID) )

    // console.log(`providers :`,otherProviders)
    for(let provider of otherProviders){

      let strPeerId = provider.id.toB58String();
      if(strPeerId === process.env.PEER_ID)
        continue;

      console.log('pinging ', strPeerId)
      const latency = await this.muon.libp2p.ping(provider.id)
      console.log({latency})
    }
    this.serviceProviders = otherProviders;

    setTimeout(this.updatePeerList.bind(this), 30000)
  }

  async initializeService(){
    let serviceCID = await NodeUtils.common.strToCID(this.APP_BROADCAST_CHANNEL)
    await this.muon.libp2p.contentRouting.provide(serviceCID)
    this.serviceId = serviceCID
    console.log({serviceCID: serviceCID.toString()})
    setTimeout(this.updatePeerList.bind(this), 9000);
  }

  @gatewayMethod('status')
  async getStatus(data){
    let providers = await all(this.muon.libp2p.contentRouting.findProviders(this.serviceId, {timeout: 5000}))
    return {
      serviceId: this.serviceId.toString(),
      providers//: providers.map(p => p.id.toB58String()),
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

    // this.broadcastNewRequest(newRequest)
    this.serviceProviders.map(async provider => {
      this.remoteCall(provider, 'wantSign', newRequest)
        .then(sign => {
          console.log('wantSign response', sign);
          (new Signature(sign)).save();
        })
    })

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


  @remoteMethod('wantSign')
  async remoteWantSign(request){
    let sign = await this.processRemoteRequest(request)
    console.log('wantSign', request._id, sign)
    return sign;
  }
}

module.exports = TestPlugin;
