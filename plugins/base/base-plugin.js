const Events = require('events-async')
const PeerId = require('peer-id')

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

    let peer = await this.muon.libp2p.peerRouting.findPeer(peerId)
    return  peer;
  }
}
