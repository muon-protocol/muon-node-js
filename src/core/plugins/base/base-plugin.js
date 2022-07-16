const Events = require('events-async')
const PeerId = require('peer-id')
const uint8ArrayFromString = require('uint8arrays/from-string').fromString;
const uint8ArrayToString = require('uint8arrays/to-string').toString;

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

  get peerId(){
    throw "peerId moved to networking module"
    // return this.muon.peerId;
  }

  get BROADCAST_CHANNEL(){
    if(this.__broadcastHandlerMethod === undefined)
      return null;
    let superClass = Object.getPrototypeOf(this);
    return `${superClass.constructor.name}.${this.__broadcastHandlerMethod}`
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
    this.muon.getPlugin('broadcast').broadcast(this.BROADCAST_CHANNEL, data);
  }
}
