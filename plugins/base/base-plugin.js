const Events = require('events-async')
const PeerId = require('peer-id')
const crypto = require('../../utils/crypto')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')

function classNames(target){
  let names = []
  let tmp = target
  while (!!tmp && (tmp.name || tmp.constructor.name)){
    names.push(tmp.name || tmp.constructor.name)
    tmp = Object.getPrototypeOf(tmp);
  }
  return names;
}

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

    let {__remoteMethods, __gatewayMethods} = this;

    if(__remoteMethods) {
      __remoteMethods.forEach(item => {
        this.registerRemoteMethod(item.title, this[item.property].bind(this))
      })
    }
    if(__gatewayMethods) {
      let gateway = this.muon.getPlugin('gateway-interface')

      let isApp = classNames(Object.getPrototypeOf(this)).includes('BaseAppPlugin')

      __gatewayMethods.forEach(item =>{
        console.log('========', item)
        if(isApp)
          gateway.registerAppCall(this.APP_NAME, item.title, this[item.property].bind(this))
        else
          gateway.registerMuonCall(item.title, this[item.property].bind(this))
      })
    }
  }

  remoteCall(peer, methodName, data){
    let remoteCall = this.muon.getPlugin('remote-call')
    let remoteMethodEndpoint = this.remoteMethodEndpoint(methodName)
    if(Array.isArray(peer)){
      return Promise.all(peer.map(p => remoteCall.call(p, remoteMethodEndpoint, data)))
    }
    else{
      return remoteCall.call(peer, remoteMethodEndpoint, data)
    }
  }

  registerRemoteMethod(title, method){
    let remoteCall = this.muon.getPlugin('remote-call')
    if(process.env.VERBOSE){
      console.log(`Registering remote method: ${this.remoteMethodEndpoint(title)}`)
    }
    remoteCall.on(this.remoteMethodEndpoint(title), method)
  }

  remoteMethodEndpoint(title) {
    let superClass = Object.getPrototypeOf(this);
    return `${superClass.constructor.name}.${title}`
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
      console.trace(`broadcast not available for plugin ${currentPlugin.constructor.name}`)
      return;
    }
    let dataStr = JSON.stringify(data)
    let signature = crypto.sign(dataStr)
    let msg = `${signature}|${dataStr}`
    this.muon.libp2p.pubsub.publish(broadcastChannel, uint8ArrayFromString(msg))
  }

  broadcastToMethod(method, params) {
    this.broadcast({method, params})
  }

  async __onPluginBroadcastReceived(msg){
    try{
      // let data = JSON.parse(uint8ArrayToString(msg.data));

      let [sign, message] = uint8ArrayToString(msg.data).split('|');
      let sigOwner = crypto.recover(message, sign)
      let data = JSON.parse(message)

      let collateralPlugin = this.muon.getPlugin('collateral');
      let validWallets = collateralPlugin.getWallets()

      let {method, params} = data;

      if(!validWallets.includes(sigOwner)){
        throw {message: `Unrecognized request owner ${sigOwner}`}
      }
      else{
        /*eslint no-undef: "error"*/
        if(method) {
          let _endpoint = this.remoteMethodEndpoint(method);
          let remoteCall = this.muon.getPlugin('remote-call');
          if (remoteCall.hasMethodHandler(_endpoint)) {
            await remoteCall.handleBroadcast(_endpoint, params, sigOwner);
          }
          else {
            await this.onBroadcastReceived(data, {wallet: sigOwner});
          }
        }
        else{
          await this.onBroadcastReceived(data, {wallet: sigOwner});
        }
      }

    }
    catch (e) {
      console.log('BasePlugin.__onPluginBroadcastReceived', e)
      // throw e;
    }
  }
}
