
class TssParty {
  t = 0
  id = null;
  partners = {}

  constructor(t, id){
    this.t = t;
    this.id = id || `P${Date.now()}-${Math.floor(Math.random()*9999999)}`
    this.partners = {
      [process.env.SIGN_WALLET_ADDRESS]: {
        peerId: process.env.PEER_ID,
        wallet: process.env.SIGN_WALLET_ADDRESS,
      }
    }
  }

  addPartner(partner){
    if(this.partners[partner.wallet] === undefined) {
      this.partners[partner.wallet] = partner
    }
  }

  setPeers(peers){
    let id2wallet = {}
    for(let wallet in this.partners){
      let {peerId} = this.partners[wallet]
      id2wallet[peerId] = wallet
    }
    peers.map(peer => {
      let key = peer.id.toB58String()
      let wallet = id2wallet[key]
      this.partners[wallet].peer = peer
    })
  }

  isFullFilled(){
    let {partners, t} = this;
    return Object.keys(partners).length >= t;
  }

  getPeers(){
    let peersWallet = Object.keys(this.partners).filter(wallet => wallet !== process.env.SIGN_WALLET_ADDRESS)
    return peersWallet.map(w => this.partners[w].peer).filter(p => !!p)
  }

  size(){
    return Object.keys(this.partners).length
  }

  makePoly(){
  }
}

module.exports = TssParty;
