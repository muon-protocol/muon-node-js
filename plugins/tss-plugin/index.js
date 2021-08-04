const BasePlugin = require('../base/base-plugin')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
const Party = require('./party')

const MSG_TYPE_JOIN_PARTY_REQ = 'join_party_request'
const MSG_TYPE_JOIN_PARTY_RES = 'join_party_response'

class TssPlugin extends BasePlugin {

  constructor(...params){
    super(...params)

    this.t = 2;
    this.n = 4;
    this.parties = {};
  }

  async onStart(){
    let broadcastChannel = this.getBroadcastChannel()
    await this.muon.libp2p.pubsub.subscribe(broadcastChannel)
    this.muon.libp2p.pubsub.on(broadcastChannel, this.__onBroadcastReceived.bind(this))

    let remoteCall = this.muon.getPlugin('remote-call')
    remoteCall.on(`remote:tss-join-to-party`, this.__joinToParty.bind(this))
  }

  getBroadcastChannel() {
    return `muon/tss/comm/broadcast`;
  }

  async keyGen(){
    let party = new Party();
    this.parties[party.id] = party;

    this.broadcast({
      type: MSG_TYPE_JOIN_PARTY_REQ,
      id: party.id,
      peerId: process.env.PEER_ID,
      wallet: process.env.SIGN_WALLET_ADDRESS,
    })
  }

  async sign(hash){
  }

  async verify(hash, sign){
  }

  async handleIncomingMessage(msg){
    console.log(msg);
    let remoteCall = this.muon.getPlugin('remote-call')
    switch (msg.type) {
      case MSG_TYPE_JOIN_PARTY_REQ: {
        let peer = await this.findPeer(msg.peerId)
        let result = await remoteCall.call(
          peer,
          `tss-join-to-party`,
          {
            id: msg.id,
            peerId: process.env.PEER_ID,
            wallet: process.env.SIGN_WALLET_ADDRESS
          }
        )
        console.log(result)
        break
      }
      default:
        console.log(`unknown message`, msg);
    }
  }

  async __onBroadcastReceived(msg) {
    try {
      let data = JSON.parse(uint8ArrayToString(msg.data));
      this.handleIncomingMessage(data)
    } catch (e) {
      console.error(e)
    }
  }

  broadcast(data) {
    let broadcastChannel = this.getBroadcastChannel()
    if (!broadcastChannel)
      return;
    let str = JSON.stringify(data)
    this.muon.libp2p.pubsub.publish(broadcastChannel, uint8ArrayFromString(str))
  }

  async __joinToParty(data){
    console.log('__joinToParty', data)
  }
}

module.exports = TssPlugin;
