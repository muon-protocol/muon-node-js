
class TssParty {
  constructor(){
    this.id = `${process.env.PEER_ID}-${Date.now()}-${Math.floor(Math.random()*9999999)}`
    this.partners = {
      [process.env.SIGN_WALLET_ADDRESS]: {
        peerId: process.env.PEER_ID,
        wallet: process.env.SIGN_WALLET_ADDRESS,
      }
    }
  }

  addPartner(partner){
    if(this.partners[partner.address] === undefined) {
      this.partners[partner.address] = partner
    }
  }
}

module.exports = TssParty;
