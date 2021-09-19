const CallablePlugin = require('./base/callable-plugin')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
const {timeout} = require('../utils/helpers')
const Party = require('./tss-plugin/party')

const MSG_TYPE_PARTY_SEARCH_REQ = 'search_party_request'

const RemoteMethods = {
  searchPartyResult: 'searchPartyResult',
}

class Search {
  id = null;
  t = null;
  max = null;
  parties = {};
  constructor(t, max){
    this.t = t
    this.max = max;
    this.id = `S-${Date.now()}-${parseInt(Math.random()*9999999)}`
  }

  addResponse(response){
    // TODO: detect misbehaving
    let {party, wallet, partners} = response;
    /**
     * wallet must be in partners
     */
    if(!this.parties[party.id])
      this.parties[party.id] = {responses: {}}
    if(partners.findIndex(p => p.wallet===wallet) > -1)
      this.parties[party.id].responses[wallet] = response
  }

  getParties(){
    let {t: TSS_THRESHOLD} = this
    //
    return Object.entries(this.parties).map(([partyId, result]) => {
      let {responses} = result
      let responders = Object.keys(responses)
      if(responders.length < TSS_THRESHOLD)
        return null;

      let party = responses[responders[0]].party;

      /**
       * Accumulate all partners from all responses
       */
      let allPartners = Array.prototype.concat.apply([], Object.values(responses).map(r => r.partners));

      /**
       * make partners unique
        */
      allPartners = allPartners.reduce((obj, p) => {
        obj[p.wallet] = p;
        return obj;
      }, {})
      allPartners = Object.values(allPartners);
      // console.log({allPartners})

      /**
       * if at least {TSS_THRESHOLD} number of partners agree with a partner,
       * that partner will include in party
       */
      allPartners = allPartners.filter(_p => {
        let agreement = Object.values(responses).reduce((acc, res) => {
          /**
           * check this response contains partner [_p] pr not.
           */
          for(let p of res.partners){
            if(p.wallet === _p.wallet)
              return acc+1;
          }
          return acc
        }, 0);
        return agreement >= TSS_THRESHOLD;
      })
      // console.log({allPartners})

      /**
       * check final partners length
       */
      if(allPartners.length < TSS_THRESHOLD)
        return null;

      return {
        ...party,
        partners: allPartners
      }
    })
  }

  isFulfilled(){
    let {t, responses} = this;
    return Object.keys(responses).length >= t
  }

  validate(){
    // TODO: not implemented
    return true
  }
}

class TssPartySearchPlugin extends CallablePlugin {

  searches = {};

  async onStart() {
    let broadcastChannel = this.getBroadcastChannel()
    await this.muon.libp2p.pubsub.subscribe(broadcastChannel)
    this.muon.libp2p.pubsub.on(broadcastChannel, this.__onBroadcastReceived.bind(this))

    this.registerRemoteMethod(RemoteMethods.searchPartyResult, this.__searchPartyResult.bind(this))
  }

  getBroadcastChannel() {
    return `muon/tss/party-search/broadcast`;
  }

  broadcast(data) {
    let broadcastChannel = this.getBroadcastChannel()
    if (!broadcastChannel)
      return;
    let str = JSON.stringify(data)
    this.muon.libp2p.pubsub.publish(broadcastChannel, uint8ArrayFromString(str))
  }

  async __onBroadcastReceived(msg) {
    try {
      let data = JSON.parse(uint8ArrayToString(msg.data));
      await this.handleBroadcastMessage(data)
    } catch (e) {
      console.error('TssPlugin.__onBroadcastReceived', e)
    }
  }

  async handleBroadcastMessage(msg){
    console.log('TssPartySearch.handleBroadcastMessage', msg);
    let tssPlugin = this.muon.getPlugin('tss-plugin')
    switch (msg.type) {
      case MSG_TYPE_PARTY_SEARCH_REQ:{
        if(tssPlugin.isReady) {
          let {searchId, peerId} = msg;
          let peer = await this.findPeer(peerId)
          let {tssParty} = tssPlugin
          await this.remoteCall(
            peer,
            RemoteMethods.searchPartyResult,
            {
              searchId,
              party: {
                id: tssParty.id,
                t: tssParty.t,
                max: tssParty.max,
              },
              wallet: process.env.SIGN_WALLET_ADDRESS,
              partners: Object.values(tssParty.partners).map(({i, wallet, peerId}) => ({i, wallet, peerId}))
            }
          )
        }
        break;
      }
      default:
        console.log(`unknown message`, msg);
    }
  }

  get tssPlugin(){
    return this.muon.getPlugin('tss-plugin')
  }

  async searchParty(numTry = 10){
    let {TSS_THRESHOLD, TSS_MAX} = this.tssPlugin;
    let n = numTry, search;
    while (n > 0) {
      try {
        console.log('trying to find existing tss group ...')
        search = new Search(TSS_THRESHOLD, TSS_MAX);
        this.searches[search.id] = search
        this.broadcast({
          type: MSG_TYPE_PARTY_SEARCH_REQ,
          searchId: search.id,
          peerId: process.env.PEER_ID,
          wallet: process.env.SIGN_WALLET_ADDRESS,
        })
        // wait to fulfill
        await timeout(3000)
        // console.dir(search, {depth: null});
        let parties = search.getParties()
        // console.dir(parties, {depth: null});
        if(parties[0]){
          return parties[0];
        }
      } catch (e) {
        console.log('TsPlugin.searchParty', e, e.stack)
      }
      timeout(5000);
      n--;
    }
    return null
  }

  /**==================================
   *
   *           Remote Methods
   *
   *===================================*/

  async __searchPartyResult(data={}){
    // console.log('TssPlugin.__searchPartyResult', data)
    let {searchId, ...response} = data
    let search = this.searches[searchId]
    search.addResponse(response);
  }
}

module.exports = TssPartySearchPlugin;
