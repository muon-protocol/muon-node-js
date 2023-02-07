import CollateralInfoPlugin from "../collateral-info.js";
import {Network} from "../../index.js";
import NetworkBroadcastPlugin from "../network-broadcast.js";
import Events from 'events-async'
import {isPeerId, Libp2pPeer, Libp2pPeerInfo, PeerId} from '../../types.js';
import {peerIdFromString} from '@libp2p/peer-id'
import {logger, Logger} from '@libp2p/logger'
import {fromString as uint8ArrayFromString} from 'uint8arrays/from-string';
import {toString as uint8ArrayToString} from 'uint8arrays/to-string';
import {peerId2Str} from "../../utils.js";

export default class BaseNetworkPlugin extends Events {
  network: Network;
  configs = {}
  protected defaultLogger: Logger;

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
    this.defaultLogger = logger(`muon:network:plugin:${this.ConstructorName}`)
  }

  /**
   * This method will call immediately after Network start.
   * @returns {Promise<void>}
   */
  async onStart(){
    this.registerBroadcastHandler()
  }

  async findPeer(peerId): Promise<Libp2pPeerInfo|null>{
    if(!isPeerId(peerId)) {
      try {
        peerId = peerIdFromString(peerId)
      }catch (e) {
        throw `Invalid string PeedID [${peerId}]: ${e.message}`;
      }
    }
    try {
      let peer: Libp2pPeer = await this.network.libp2p.peerStore.get(peerId)
        .catch(e => null)
      if(peer) {
        this.defaultLogger(`peer found local %p`, peerId)
        return {
          id: peerId,
          multiaddrs: peer.addresses.map(addr => addr.multiaddr),
          protocols: []
        };
      }
      this.defaultLogger(`peer not found local %p`, peerId)
      return await this.network.libp2p.peerRouting.findPeer(peerId)
    }
    catch (e) {
      // TODO: what to do?
      // this.defaultLogger("%o", e)
      console.log('MUON_PEER_NOT_FOUND', peerId)
      return null;
    }
  }

  async findPeerLocal(peerId): Promise<Libp2pPeerInfo|null>{
    if(!isPeerId(peerId)) {
      try {
        peerId = peerIdFromString(peerId)
      }catch (e) {
        throw `Invalid string PeedID [${peerId}]: ${e.message}`;
      }
    }
    try {
      let ret = await this.network.libp2p.peerStore.get(peerId)
      return {
        id: ret.id,
        multiaddrs: ret.addresses.map(x => x.multiaddr),
        protocols: []
      }
    }
    catch (e) {
      // TODO: what to do?
      // this.defaultLogger("%o", e)
      console.log('MUON_PEER_NOT_FOUND', peerId)
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
    // @ts-ignore
    if(this.__broadcastHandlerMethod === undefined)
      return null;
    // @ts-ignore
    return `muon.network.${this.ConstructorName}.${this.__broadcastHandlerMethod}`
  }

  async registerBroadcastHandler(){
    await this.__broadcastPlugin.subscribe(this.BROADCAST_CHANNEL)
    // @ts-ignore
    this.__broadcastPlugin.on(this.BROADCAST_CHANNEL, this.__onPluginBroadcastReceived.bind(this))
  }

  broadcast(data){
    let broadcastChannel = this.BROADCAST_CHANNEL
    if (!broadcastChannel) {
      // this.defaultLogger.error(`Broadcast not available for plugin ${this.ConstructorName}`)
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
      // @ts-ignore
      let broadcastHandler = this[this.__broadcastHandlerMethod].bind(this);
      await broadcastHandler(data, callerInfo);
    }
    catch (e) {
      // this.defaultLogger.error("%o", e)
      throw e;
    }
  }
}
