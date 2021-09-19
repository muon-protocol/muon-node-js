const Events = require('events-async')
const PeerId = require('peer-id')
const errcode = require('err-code');

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
}
