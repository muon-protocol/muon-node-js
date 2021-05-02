const BasePlugin = require('./base-plugin')
const Request = require('../gateway/models/Request')
const Signature = require('../gateway/models/Signature')
const PeerId = require('peer-id')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
const NodeUtils = require('../utils/node-utils')

const REQUEST_BROADCAST_CHANNEL = "muon/request/new"

class RequestHandlerPlugin extends BasePlugin{

  broadcastNewRequest(data){
    let dataStr = JSON.stringify(data)
    this.muon.libp2p.pubsub.publish(REQUEST_BROADCAST_CHANNEL, uint8ArrayFromString(dataStr))
  }

  async onRemoteRequestSign(msg){
    let remoteCall = this.muon.getPlugin('remote-call');
    try {
      let data = JSON.parse(uint8ArrayToString(msg.data));
      if(data && data.type === 'new_request'){
        let peerId = PeerId.createFromCID(data.peerId)
        let peer = await this.muon.libp2p.peerRouting.findPeer(peerId);
        let request = await remoteCall.call(peer, 'get-request', {_id: data.id})
        // let request = await NodeUtils.getRequestInfo(data.id)
        if(request){
          // console.log(`request info found: `, request)
          let sign = await NodeUtils.signRequest(request, false)
          await remoteCall.call(peer, 'request-sign', sign)
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

  getPeerInfo(data){
    // console.log('RequestHandler.getPeerInfo', data)
    let peerId = PeerId.createFromCID(data.peerId)
    this.muon.libp2p.peerRouting.findPeer(peerId)
      .then(peer =>{
        return this.muon.getPlugin('remote-call').call(peer, 'get-request', {_id: '6087ff68d4255e6e7c76778a'})
      })
      .then(result => {
        console.log('remote-call resolved', result)
      })
  }

  async onStart(){
    /**
     * Broadcast new request info
     */
    let gatewayPlugin = this.muon.getPlugin('gateway-interface')
    gatewayPlugin.on('data/new_request', this.broadcastNewRequest)
    gatewayPlugin.on('data/peer_info', this.getPeerInfo.bind(this))
    this.muon.getPlugin('remote-call').on('remote:get-request', this.responseToRemoteRequestData.bind(this))
    this.muon.getPlugin('remote-call').on('remote:request-sign', this.responseToRemoteRequestSign.bind(this))

    /**
     * Listen to network to get new requests
     */
    await this.muon.libp2p.pubsub.subscribe(REQUEST_BROADCAST_CHANNEL)
    this.muon.libp2p.pubsub.on(REQUEST_BROADCAST_CHANNEL, this.onRemoteRequestSign.bind(this))

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
    console.log('RemoteCall.getRequestData', signature)
    let signer = NodeUtils.recoverSignature(signature);
    if(signer === signature.owner) {
      let newSignature = new Signature(signature)
      await newSignature.save();
    }
  }

}

module.exports = RequestHandlerPlugin;
