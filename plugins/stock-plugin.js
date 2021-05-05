const BasePlugin = require('./base-plugin')
const Request = require('../gateway/models/Request')
const Signature = require('../gateway/models/Signature')
const PeerId = require('peer-id')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
const NodeUtils = require('../utils/node-utils')
const Sources = require('../gateway/sources')
const {timeout, getTimestamp} = require('../utils/helpers')
const fs = require('fs')

const REQUEST_BROADCAST_CHANNEL = "muon/request/new"

class StockPlugin extends BasePlugin {

  async onGetPrice(data){
    let {symbol, source = "finnhub"} = data || {}
    if (!symbol) {
      throw {message: "Missing symbol param"}
    }
    let price = await Sources.getSymbolPrice(symbol, source)
    if (!price) {
      throw {"message": "Price not found"}
    }

    let startedAt = Date.now();
    let newRequest = new Request({
      app: 'stock',
      owner: process.env.SIGN_WALLET_ADDRESS,
      peerId: process.env.PEER_ID,
      data: {
        symbol: symbol,
        price: price['price'],
        timestamp: price['timestamp'],
        source: source,
        rawPrice: price,
      },
      startedAt,
    })
    await newRequest.save()
    await NodeUtils.Stock.signRequest(newRequest);
    this.broadcastNewRequest({
      type: 'new_request',
      peerId:  process.env.PEER_ID,
      _id: newRequest._id
    })
    let secondsToCheck = 0
    let confirmed = false
    let allSignatures = []
    let signers = {}

    while(secondsToCheck < 5) {
      await timeout(250);
      allSignatures = await Signature.find({request: newRequest._id})
      signers = {};
      for(let sig of allSignatures){
        let sigOwner = NodeUtils.Stock.recoverSignature(sig)
        if(sigOwner !== sig['owner'])
          continue;

        signers[sigOwner] = true;
      }

      if(Object.keys(signers).length >= parseInt(process.env.NUM_SIGN_TO_CONFIRM)){
        confirmed = true;
        newRequest['confirmedAt'] = Date.now()
        await newRequest.save()
        break;
      }
      secondsToCheck += 0.25
    }

    let requestData = {
      confirmed,
      ...newRequest._doc,
      signatures: allSignatures.filter(sig => Object.keys(signers).includes(sig['owner'])).map(sig => ({
        "owner": sig['owner'],
        "timestamp": sig['timestamp'],
        "price": sig['data']['price'],
        "signature": sig['signature'],
      })),
    }

    if(confirmed){
      await this.emit('request-signed', requestData)
    }

    return {
      cid: await NodeUtils.Stock.createCID(requestData),
      ...requestData
    }
  }

  broadcastNewRequest(data){
    let dataStr = JSON.stringify(data)
    this.muon.libp2p.pubsub.publish(REQUEST_BROADCAST_CHANNEL, uint8ArrayFromString(dataStr))
  }

  async onBroadcastReceived(msg){
    let remoteCall = this.muon.getPlugin('remote-call');
    try {
      let data = JSON.parse(uint8ArrayToString(msg.data));
      if(data && data.type === 'new_request'){
        let peerId = PeerId.createFromCID(data.peerId)
        let peer = await this.muon.libp2p.peerRouting.findPeer(peerId);
        let request = await remoteCall.call(peer, 'stock-get-request', {_id: data._id})
        // let request = await NodeUtils.getRequestInfo(data.id)
        if(request){
          // console.log(`request info found: `, request)
          let sign = await NodeUtils.Stock.signRequest(request, false)
          await remoteCall.call(peer, 'stock-request-sign', sign)
        }
        else{
          // console.log(`request info not found "${data.id}"`)
        }
      }
    }
    catch (e) {
      console.error(e)
    }
  }

  async onStart(){
    let gatewayPlugin = this.muon.getPlugin('gateway-interface')
    gatewayPlugin.registerAppCall('stock', 'get_price', this.onGetPrice.bind(this))

    /**
     * Listen to network broadcast to get new requests
     */
    await this.muon.libp2p.pubsub.subscribe(REQUEST_BROADCAST_CHANNEL)
    this.muon.libp2p.pubsub.on(REQUEST_BROADCAST_CHANNEL, this.onBroadcastReceived.bind(this))
    /**
     * Remote calls registration
     */
    this.muon.getPlugin('remote-call').on('remote:stock-get-request', this.responseToRemoteRequestData.bind(this))
    this.muon.getPlugin('remote-call').on('remote:stock-request-sign', this.responseToRemoteRequestSign.bind(this))
  }

  /**
   * Remote call handlers
   * This methods will call from remote peer
   */

  async responseToRemoteRequestData(data){
    console.log('RemoteCall.getRequestData', data)
    let req = await Request.findOne({_id: data._id})
    return req
  }

  async responseToRemoteRequestSign(signature){
    // console.log('RemoteCall.getRequestData', signature)
    let signer = NodeUtils.Stock.recoverSignature(signature);
    if(signer === signature.owner) {
      let newSignature = new Signature(signature)
      await newSignature.save();
    }
  }
}

module.exports = StockPlugin;
