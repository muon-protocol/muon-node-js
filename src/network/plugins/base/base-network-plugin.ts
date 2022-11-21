import CollateralInfoPlugin from "../collateral-info";
import {Network} from "../../index";
import NetworkBroadcastPlugin from "../network-broadcast";

const Events = require('events-async')
const PeerId = require('peer-id')
const uint8ArrayFromString = require('uint8arrays/from-string').fromString;
const uint8ArrayToString = require('uint8arrays/to-string').toString;

export default class BaseNetworkPlugin extends Events {
  network: Network;
  configs = {}

  constructor(network: Network, configs){
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
   * This method will call immediately after Network start.
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

  private get __broadcastPlugin(): NetworkBroadcastPlugin {
    return this.network.getPlugin('broadcast')
  }

  get BROADCAST_CHANNEL(){
    if(this.__broadcastHandlerMethod === undefined)
      return null;
    return `muon.network.${this.ConstructorName}.${this.__broadcastHandlerMethod}`
  }

  async registerBroadcastHandler(){
    await this.__broadcastPlugin.subscribe(this.BROADCAST_CHANNEL)
    this.__broadcastPlugin.on(this.BROADCAST_CHANNEL, this.__onPluginBroadcastReceived.bind(this))
  }

  broadcast(data){
    let broadcastChannel = this.BROADCAST_CHANNEL
    if (!broadcastChannel) {
      console.log(`Broadcast not available for plugin ${this.ConstructorName}`)
      return;
    }
    this.__broadcastPlugin.rawBroadcast(this.BROADCAST_CHANNEL, data)
  }

  broadcastToChannel(channel, data) {
    this.__broadcastPlugin.rawBroadcast(channel, data)
  }

  async __onPluginBroadcastReceived(data, callerInfo){
    // console.log("BaseNetworkPlugin.__onPluginBroadcastReceived", {data, callerInfo})
    try{

      let broadcastHandler = this[this.__broadcastHandlerMethod].bind(this);
      await broadcastHandler(data, callerInfo);
    }
    catch (e) {
      console.log(`${this.ConstructorName}.__onPluginBroadcastReceived`, e)
      throw e;
    }
  }
}
