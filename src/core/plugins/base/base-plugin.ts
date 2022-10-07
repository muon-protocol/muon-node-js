import Muon from "../../muon";

const Events = require('events-async')
const PeerId = require('peer-id')
const uint8ArrayFromString = require('uint8arrays/from-string').fromString;
const uint8ArrayToString = require('uint8arrays/to-string').toString;
const SharedMem = require('../../../common/shared-memory')

export default class BasePlugin extends Events{
  private readonly _muon;
  configs = {}

  constructor(muon, configs){
    super()
    this._muon = muon
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

  get muon(): Muon {
    return this._muon;
  }

  get peerId(){
    throw "peerId moved to networking module"
    // return this.muon.peerId;
  }

  get ConstructorName() {
    let superClass = Object.getPrototypeOf(this);
    return superClass.constructor.name
  }

  protected get BROADCAST_CHANNEL(){
    if(this.__broadcastHandlerMethod === undefined)
      return null;
    return `${this.ConstructorName}.${this.__broadcastHandlerMethod}`
  }

  async registerBroadcastHandler(){
    let broadcastChannel = this.BROADCAST_CHANNEL
    /*eslint no-undef: "error"*/
    if (broadcastChannel) {
      if(process.env.VERBOSE) {
        console.log('Subscribing to broadcast channel', this.BROADCAST_CHANNEL)
      }
      this.muon.getPlugin('broadcast').on(broadcastChannel, this[this.__broadcastHandlerMethod].bind(this))
    }
  }

  broadcast(data){
    if(this.__broadcastHandlerMethod === undefined) {
      console.log(this);
      let superClass = Object.getPrototypeOf(this);
      throw `${superClass.constructor.name} is not declared broadcast handler`;
    }
    this.muon.getPlugin('broadcast')
        .broadcastToChannel(this.BROADCAST_CHANNEL, data)
        .catch(e => {
          console.log(`${this.ConstructorName}.broadcast`, e)
        })
  }

  sharedMemKey(key) {
    return `core.plugins.${this.ConstructorName}.${key}`
  }

  async setSharedMem(key, value) {
    return await SharedMem.set(this.sharedMemKey(key), value)
  }

  async getSharedMem(key) {
    return await SharedMem.get(this.sharedMemKey(key))
  }

  async clearSharedMem(key) {
    return await SharedMem.clear(this.sharedMemKey(key))
  }

}
