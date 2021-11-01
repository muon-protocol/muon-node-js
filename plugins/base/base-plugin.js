const Events = require('events-async')
const PeerId = require('peer-id')
const crypto = require('../../utils/crypto')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')

module.exports = class BasePlugin extends Events{
  muon = null;
  configs = {}

  constructor(muon, configs){
    super()
    this.muon = muon
    this.configs = {...configs}
  }

  /**
   * This method will call immediately after plugin create.
   * @returns {Promise<void>}
   */
  async onInit(){
  }

  /**
   * This method will call immediately after Muon start.
   * @returns {Promise<void>}
   */
  async onStart(){
    this.registerBroadcastHandler()
  }

  async findPeer(peerId){
    if(!PeerId.isPeerId(peerId))
      peerId = PeerId.createFromCID(peerId)
    try {
      return await this.muon.libp2p.peerRouting.findPeer(peerId)
    }
    catch (e) {
      // TODO: what to do?
      if(process.env.VERBOSE)
        console.error("BasePlugin.findPeer", e.stack)
      return null;
    }
  }

  get peerId(){
    return this.muon.peerId;
  }

  get peerIdStr(){
    return this.muon.peerId.toB58String();
  }

  get BROADCAST_CHANNEL(){
    let superClass = Object.getPrototypeOf(this);
    return `muon/plugin/${superClass.constructor.name}/broadcast`
  }

  async registerBroadcastHandler(){
    let broadcastChannel = this.BROADCAST_CHANNEL
    /*eslint no-undef: "error"*/
    if (broadcastChannel && this.onBroadcastReceived) {

      if(process.env.VERBOSE) {
        console.log('Subscribing to broadcast channel', this.BROADCAST_CHANNEL)
      }
      await this.muon.libp2p.pubsub.subscribe(broadcastChannel)
      this.muon.libp2p.pubsub.on(broadcastChannel, this.__onPluginBroadcastReceived.bind(this))
    }
  }

  broadcast(data){
    let broadcastChannel = this.BROADCAST_CHANNEL
    if (!broadcastChannel || !this.onBroadcastReceived) {
      let currentPlugin = Object.getPrototypeOf(this);
      console.log(`Broadcast not available for plugin ${currentPlugin.constructor.name}`)
      return;
    }
    let dataStr = JSON.stringify(data)
    let signature = crypto.sign(dataStr)
    let msg = `${signature}|${dataStr}`
    this.muon.libp2p.pubsub.publish(broadcastChannel, uint8ArrayFromString(msg))
  }

  async __onPluginBroadcastReceived(msg){
    try{
      // let data = JSON.parse(uint8ArrayToString(msg.data));

      let [sign, message] = uint8ArrayToString(msg.data).split('|');
      let sigOwner = crypto.recover(message, sign)
      let data = JSON.parse(message)

      let collateralPlugin = this.muon.getPlugin('collateral');
      let validWallets = collateralPlugin.getWallets()
      if(!validWallets.includes(sigOwner)){
        throw {message: `Unrecognized request owner ${sigOwner}`}
      }
      else{
        /*eslint no-undef: "error"*/
        await this.onBroadcastReceived(data);
      }

    }
    catch (e) {
      console.log('BasePlugin.__onPluginBroadcastReceived', e)
      // throw e;
    }
  }
}
