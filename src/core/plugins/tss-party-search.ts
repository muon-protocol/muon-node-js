import CallablePlugin from './base/callable-plugin'
const uint8ArrayFromString = require('uint8arrays/from-string').fromString;
const uint8ArrayToString = require('uint8arrays/to-string').toString;
const {timeout} = require('../../utils/helpers')
import Party from './tss-plugin/party'
const {remoteApp, remoteMethod, gatewayMethod, broadcastHandler} = require('./base/app-decorators')

const MSG_TYPE_PARTY_SEARCH_REQ = 'search_party_request'

const RemoteMethods = {
  searchPartyResult: 'searchPartyResult',
}

class Search {
  id: string;
  t: number;
  max: number;
  parties = {};
  constructor(t: number, max: number){
    this.t = t
    this.max = max;
    this.id = `S-${Date.now()}-${Math.floor(Math.random()*9999999)}`
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
      // @ts-ignore
      let {responses} = result
      let responders = Object.keys(responses)
      // @ts-ignore
      if(responders.length < TSS_THRESHOLD)
        return null;

      let party = responses[responders[0]].party;

      /**
       * Accumulate all partners from all responses
       */
          // @ts-ignore
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
        let agreement = Object.values(responses).reduce((acc: number, res) => {
          /**
           * check this response contains partner [_p] pr not.
           */
          // @ts-ignore
          for(let p of res.partners){
            if(p.wallet === _p.wallet)
              return acc+1;
          }
          return acc
        }, 0);
        // @ts-ignore
        return agreement >= TSS_THRESHOLD;
      })
      // console.log({allPartners})

      /**
       * check final partners length
       */
      // @ts-ignore
      if(allPartners.length < TSS_THRESHOLD)
        return null;

      return {
        ...party,
        partners: allPartners
      }
    })
  }

  isFulfilled(){
    // @ts-ignore
    let {t, responses} = this;
    // @ts-ignore
    return Object.keys(responses).length >= t
  }

  validate(){
    // TODO: not implemented
    return true
  }
}

@remoteApp
class TssPartySearchPlugin extends CallablePlugin {

  // TODO: replace with node-cache.
  searches = {};

  @broadcastHandler
  async __onBroadcastReceived(data) {
    try {
      // let data = JSON.parse(uint8ArrayToString(msg.data));
      await this.handleBroadcastMessage(data)
    } catch (e) {
      console.error('TssPlugin.__onBroadcastReceived', e)
    }
  }

  async handleBroadcastMessage(msg){
    // console.log('TssPartySearch.handleBroadcastMessage', msg);
    let tssPlugin = this.muon.getPlugin('tss-plugin')
    switch (msg.type) {
      case MSG_TYPE_PARTY_SEARCH_REQ:{
        if(tssPlugin.isReady) {
          let {searchId, peerId} = msg;
          let {tssParty} = tssPlugin
          // @ts-ignore
          await this.remoteCall(
            peerId,
            RemoteMethods.searchPartyResult,
            {
              searchId,
              party: {
                id: tssParty.id,
                t: tssParty.t,
                max: tssParty.max,
              },
              wallet: process.env.SIGN_WALLET_ADDRESS,
              // @ts-ignore
              partners: Object.values(tssParty.partners).map(({wallet, peerId}) => ({wallet, peerId}))
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
        // @ts-ignore
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

  @remoteMethod(RemoteMethods.searchPartyResult)
  async __searchPartyResult(data={}){
    // console.log('TssPlugin.__searchPartyResult', data)
    // @ts-ignore
    let {searchId, ...response} = data
    let search = this.searches[searchId]
    search.addResponse(response);
  }
}

export default TssPartySearchPlugin;
