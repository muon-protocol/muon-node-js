const CallablePlugin = require('./base/callable-plugin')
const {remoteApp, remoteMethod, gatewayMethod} = require('./base/app-decorators')
const tssModule = require('../utils/tss')
const TimeoutPromise = require('../core/timeout-promise')

const RemoteMethods = {
  AskElectionPermission: "AskElectionPermission",
  ElectionResultReady: 'ElectionResultReady',
}

@remoteApp
class GroupLeaderPlugin extends CallablePlugin {
  lastElection = 0
  electionKey = null
  leader=null
  _leaderSelectPromise = new TimeoutPromise();

  async onStart() {
    this.TssPlugin.once('party-load', this._checkStatus.bind(this))
  }

  async _checkStatus(){
    try {
      // console.log("GroupLeaderPlugin._checkStatus", Date.now())
      let permitted = await this.isPermittedToDoElection();
      if (permitted) {
        let key = await this.TssPlugin.keyGen(null, `election-${this.lastElection+1}-key`);
        let done = await this.informElectionReady();
        if(done){
          this._electionComplete(key);
        }
        else{
        }
      }
    }
    catch (e) {
      console.log('GroupLeaderPlugin._checkStatus', 'error')
    }
    if(!this.leader)
      setTimeout(this._checkStatus.bind(this), 10000)
  }

  get TssPlugin() {
    return this.muon.getPlugin('tss-plugin')
  }

  async isPermittedToDoElection() {
    let partners = Object.values(this.TssPlugin.tssParty.onlinePartners)
      .filter(p => p.wallet !== process.env.SIGN_WALLET_ADDRESS)
    let responses = await Promise.all(partners.map(p => {
      return this.remoteCall(
        p.peer,
        RemoteMethods.AskElectionPermission,
        {election: this.lastElection+1}
      ).catch(e => 'error')
    }))
    // console.log(`election ${this.lastElection+1} permission responses`, responses);
    return responses.length+1 >= this.TssPlugin.TSS_THRESHOLD && responses.findIndex(res => res !== true) < 0;
  }

  async informElectionReady() {
    let electionKey = this.TssPlugin.keys[this.getElectionId(this.lastElection+1)];

    let partners = electionKey.partners
      .map(w => this.TssPlugin.tssParty.onlinePartners[w])
      .filter(p => p.wallet !== process.env.SIGN_WALLET_ADDRESS)

    let responses = await Promise.all(partners.map(p => {
      return this.remoteCall(
        p.peer,
        RemoteMethods.ElectionResultReady,
        {election: this.lastElection+1}
      ).catch(e => 'error')
    }))
    // console.log(`election ${this.lastElection+1} ready inform responses`, responses);
    return responses.findIndex(res => res !== true) < 0;
  }

  extractLeaderFromKey(key) {
    let partners = key.partners;
    let sharedAddress = partners
      .map(w => key.getPubKey(w))
      .map(point => tssModule.pub2addr(point))
      .map(address => address.toLowerCase());

    let leaderIndex = sharedAddress.reduce((max, val, i, arr) => (val > arr[max] ? i : max), 0);
    return partners[leaderIndex];
  }

  isLeader(){
    return this.leader === process.env.SIGN_WALLET_ADDRESS;
  }

  getElectionId(election) {
    return `election-${election}-key`
  }

  isWalletPermittedToElect(wallet, election) {
    return  election === this.lastElection+1 && wallet.toLowerCase() > process.env.SIGN_WALLET_ADDRESS.toLowerCase();
  }

  _electionComplete(key) {
    this.electionKey = key;
    this.leader = this.extractLeaderFromKey(key);
    this.lastElection ++;
    this.emit('leader-change', this.leader);
    this._leaderSelectPromise.resolve(this.leader);
    console.log(`leader is now ${this.leader}`);
  }

  waitToLeaderSelect() {
    return this._leaderSelectPromise.promise;
  }

  @remoteMethod(RemoteMethods.AskElectionPermission)
  async _askElectionPermission(data={}, callerInfo) {
    // console.log('GroupLeaderPlugin.AskElectionPermission', {data, callerInfo});
    let {election} = data;
    return this.isWalletPermittedToElect(callerInfo.wallet, election)
  }

  @remoteMethod(RemoteMethods.ElectionResultReady)
  async _electionResultReady(data={}, callerInfo) {
    // console.log('GroupLeaderPlugin.ElectionResultReady', {data, callerInfo});
    let {election} = data;
    let permitted = this.isWalletPermittedToElect(callerInfo.wallet, election);
    if(permitted){
      let key = this.TssPlugin.keys[this.getElectionId(election)];
      this._electionComplete(key);
      return true;
    }
  }
}

module.exports = GroupLeaderPlugin;
