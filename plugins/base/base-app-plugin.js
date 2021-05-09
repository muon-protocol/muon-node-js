const BasePlugin = require('./base-plugin')
const Request = require('../../gateway/models/Request')
const Signature = require('../../gateway/models/Signature')
const PeerId = require('peer-id')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
const {getTimestamp, timeout} = require('../../utils/helpers')

class BaseAppPlugin extends BasePlugin {
  APP_BROADCAST_CHANNEL = null
  APP_NAME = null;

  constructor(...args) {
    super(...args);

    /**
     * This is abstract class, so "new BaseAppPlugin()" is not allowed
     */
    if (new.target === BaseAppPlugin) {
      throw new TypeError("Cannot construct abstract BaseAppPlugin instances directly");
    }
  }

  async onStart(){
    /**
     * Subscribe to app broadcast channel
     */

    if(!!this.APP_BROADCAST_CHANNEL) {
      await this.muon.libp2p.pubsub.subscribe(this.APP_BROADCAST_CHANNEL)
      this.muon.libp2p.pubsub.on(this.APP_BROADCAST_CHANNEL, this.__onBroadcastReceived.bind(this))
    }
    /**
     * Remote call handlers
     */
    this.muon.getPlugin('remote-call').on(`remote:app-${this.APP_NAME}-get-request`, this.__responseToRemoteRequestData.bind(this))
    this.muon.getPlugin('remote-call').on(`remote:app-${this.APP_NAME}-request-sign`, this.__responseToRemoteRequestSign.bind(this))
  }

  /**
   * This method should response a Signature model object
   * @param request
   * @returns {Promise<void>} >> Response object
   */
  async processRemoteRequest(request){
  }

  async isOtherNodesConfirmed(newRequest, numNodesToConfirm){
    let secondsToCheck = 0
    let confirmed = false
    let allSignatures = []
    let signers = {}

    while(!confirmed && secondsToCheck < 5) {
      await timeout(250);
      allSignatures = await Signature.find({request: newRequest._id})
      signers = {};
      for(let sig of allSignatures){
        let sigOwner = this.recoverSignature(newRequest, sig)
        if(!!sigOwner && sigOwner !== sig['owner'])
          continue;

        signers[sigOwner] = true;
      }

      if(Object.keys(signers).length >= numNodesToConfirm){
        confirmed = true;
      }
      secondsToCheck += 0.25
    }

    return [confirmed, allSignatures.filter(sig => Object.keys(signers).includes(sig['owner'])).map(sig => ({
      "owner": sig['owner'],
      "timestamp": sig['timestamp'],
      "result": sig['data'],
      "signature": sig['signature'],
    }))]
  }

  async __onBroadcastReceived(msg){
    let remoteCall = this.muon.getPlugin('remote-call');
    try {
      let data = JSON.parse(uint8ArrayToString(msg.data));
      if(data && data.type === 'new_request'){
        let peerId = PeerId.createFromCID(data.peerId)
        let peer = await this.muon.libp2p.peerRouting.findPeer(peerId);
        let request = await remoteCall.call(peer, `app-${this.APP_NAME}-get-request`, {_id: data._id})
        if(request){
          // console.log(`request info found: `, request)
          let sign = await this.processRemoteRequest(request)
          await remoteCall.call(peer, `app-${this.APP_NAME}-request-sign`, sign)
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

  recoverSignature(request, signature){}

  broadcastNewRequest(request){
    let data = {
      type: 'new_request',
      peerId:  process.env.PEER_ID,
      _id: request._id
    }
    let dataStr = JSON.stringify(data)
    this.muon.libp2p.pubsub.publish(this.APP_BROADCAST_CHANNEL, uint8ArrayFromString(dataStr))
  }

  remoteMethodEndpoint(title){
    return `app-${this.APP_NAME}-${title}`
  }

  remoteCall(peer, methodName, data){
    let remoteCall = this.muon.getPlugin('remote-call');
    let remoteMethodEndpoint = this.remoteMethodEndpoint(methodName)
    return remoteCall.call(peer, remoteMethodEndpoint, data)
  }

  /**
   * Remote call handlers
   * This methods will call from remote peer
   */

  async __responseToRemoteRequestData(data){
    // console.log('RemoteCall.getRequestData', data)
    let req = await Request.findOne({_id: data._id})
    return req
  }

  async __responseToRemoteRequestSign(sig){
    // console.log('RemoteCall.requestSignature', sig)
    let request = await Request.findOne({_id: sig.request})
    if(request) {
      let signer = this.recoverSignature(request, sig);
      if (signer && signer === sig.owner) {
        let newSignature = new Signature(sig)
        await newSignature.save();
      }
    }
  }
}

module.exports = BaseAppPlugin
