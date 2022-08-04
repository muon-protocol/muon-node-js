const Events = require('events-async')
const PeerId = require('peer-id')
const uint8ArrayFromString = require('uint8arrays/from-string').fromString;
const uint8ArrayToString = require('uint8arrays/to-string').toString;

module.exports = class BaseNetworkingPlugin extends Events {
  network = null;
  configs = {}

  constructor(network, configs){
    super()
    this.network = network
    this.configs = {...configs}
  }

  /**
   * This method will call immediately after plugin create.
   * @returns {Promise<void>}
   */
  async onInit(){
  }

  /**
   * This method will call immediately after Networking start.
   * @returns {Promise<void>}
   */
  async onStart(){
    this.registerBroadcastHandler()
  }

  async findPeer(peerId){
    if(!PeerId.isPeerId(peerId)) {
      peerId = PeerId.createFromB58String(peerId)
    }
    try {
      return await this.network.libp2p.peerRouting.findPeer(peerId)
    }
    catch (e) {
      // TODO: what to do?
      // if(process.env.VERBOSE)
        console.error("BaseNetworkPlugin.findPeer", peerId.toB58String(), e.stack)
      return null;
    }
  }

  get peerId(){
    return this.network.peerId;
  }

  get ConstructorName() {
    let superClass = Object.getPrototypeOf(this);
    return superClass.constructor.name
  }

  get BROADCAST_CHANNEL(){
    if(this.__broadcastHandlerMethod === undefined)
      return null;
    return `muon/network/plugin/${this.ConstructorName}/broadcast`
  }

  async registerBroadcastHandler(){
    let broadcastChannel = this.BROADCAST_CHANNEL
    /*eslint no-undef: "error"*/
    if (broadcastChannel) {

      if(process.env.VERBOSE) {
        console.log('Subscribing to broadcast channel', this.BROADCAST_CHANNEL)
      }
      await this.network.libp2p.pubsub.subscribe(broadcastChannel)
      this.network.libp2p.pubsub.on(broadcastChannel, this.__onPluginBroadcastReceived.bind(this))
    }
  }

  broadcast(data){
    let broadcastChannel = this.BROADCAST_CHANNEL
    if (!broadcastChannel) {
      console.log(`Broadcast not available for plugin ${this.ConstructorName}`)
      return;
    }
    let dataStr = JSON.stringify(data)
    this.network.libp2p.pubsub.publish(broadcastChannel, uint8ArrayFromString(dataStr))
  }

  async __onPluginBroadcastReceived({data: rawData, from, ...otherItems}){
    try{
      let strData = uint8ArrayToString(rawData)
      let data = JSON.parse(strData);
      let collateralPlugin = this.network.getPlugin('collateral');

      let senderWallet = collateralPlugin.getPeerWallet(from);
      if(!senderWallet){
        throw {message: `Unrecognized broadcast owner ${senderWallet}`, data: strData}
      }

      /*eslint no-undef: "error"*/
      let broadcastHandler = this[this.__broadcastHandlerMethod].bind(this);
      if(typeof from != "string")
        from = from.peerId._idB58String
      await broadcastHandler(data, {wallet: senderWallet, peerId: from});
    }
    catch (e) {
      console.log('BasePlugin.__onPluginBroadcastReceived', e)
      throw e;
    }
  }
}
