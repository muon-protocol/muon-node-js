const CallablePlugin = require('./base/callable-plugin')
const {remoteMethod, gatewayMethod} = require('./base/app-decorators')
const tssModule = require('../utils/tss')
const {timeout} = require('../utils/helpers');
const TimeoutPromise = require('../core/timeout-promise')

const RemoteMethods = {
  AskElectionPermission: "AskElectionPermission",
  ElectionStart: "ElectionStart",
  ElectionResultReady: 'ElectionResultReady',
  WhoIsLeader: 'WhoIsLeader',
}

class GroupLeaderPlugin extends CallablePlugin {
  // TODO: How about adversarial behavior?

  /**
   * Each election has an unique ID.
   * @type {number}
   */
  lastElection = 0
  /**
   * Election start time in ms.
   * @type {timestamp}
   */
  _electionStartedAt = 0
  /**
   * To do election, a distributed key will be generated.
   * Each partner has a shared address. This address cannot be determined before key generation completes.
   * Partner with the largest address will win the election.
   *
   * @type {null}
   */
  electionKey = null
  /**
   * Address of leader that win the election
   * @type {null}
   */
  leader=null
  /**
   * Promise that fulfilled at the end of election.
   * @type {TimeoutPromise}
   * @private
   */
  _leaderSelectPromise = new TimeoutPromise();

  async onStart() {
    super.onStart();

    this.TssPlugin.once('party-load', this._checkStatus.bind(this))
  }

  async _checkStatus(){
    let already = await this.leaderAlreadySelected();
    if(!!already && !this.leader){
      console.log(`leader already selected: `, already)
      this.lastElection = already.lastElection;
      this.leader = already.leader;
      this._leaderSelectPromise.resolve(already.leader);
      return ;
    }

    try {
      // console.log("GroupLeaderPlugin._checkStatus", Date.now()) // is failed: 000
      let permitted = await this.isPermittedToDoElection();
      if (permitted) {
        let started = await this.electionStart();
        if(started)
          this._electionStartedAt = Date.now();
        else
          throw {message: "Election start failed."}

        console.log(`** Got permission to do election **`);
        let key = await this.TssPlugin.keyGen(null, `election-${this.lastElection+1}-key`);
        let done = await this.informElectionReady();
        if(done){
          console.log(`Election complete successfully`);
          this._electionComplete(key);
          return;
        }
        else{
          console.log(`Election confirmation failed.`);
        }
      }
      else
        console.log(`Not permitted to do election.`);
    }
    catch (e) {
      console.log('GroupLeaderPlugin._checkStatus', 'error', e)
    }
    if(!this.leader)
      setTimeout(this._checkStatus.bind(this), 32000)
  }

  async electionStart() {
    let responses = await this.callParty(RemoteMethods.ElectionStart,{election: this.lastElection+1});
    let allDone = responses.findIndex(r => (r!==true)) < 0;
    return allDone && responses.length >= this.TssPlugin.TSS_THRESHOLD
  }

  async leaderAlreadySelected(){
    let responses = await this.callParty(RemoteMethods.WhoIsLeader)
    let leaderCount = responses.filter(r => !!r?.leader)
      .map(r => `${r.lastElection}-${r.leader}`)
      .reduce((obj, val) => {
        if(obj[val] === undefined)
          obj[val] = 0
        obj[val]++;
        return obj;
      }, {})
    // console.log(`WhoIsLeader responses`, Date.now(), leaderCount);
    if(Object.keys(leaderCount).length !== 1) {
      if(Object.keys(leaderCount).length){
        console.log('!!!!!!!!!!!!! Multiple Leader !!!!!!!!!!!!!', leaderCount)
      }
      return null
    }
    let leaderStr = Object.keys(leaderCount)[0];
    if(leaderCount[leaderStr] >= this.TssPlugin.TSS_THRESHOLD){
      let [lastElection, leader] = leaderStr.split('-')
      return {lastElection: parseInt(lastElection), leader};
    }
    else
      return null;
  }

  get TssPlugin() {
    return this.muon.getPlugin('tss-plugin')
  }

  async isPermittedToDoElection() {
    let responses = await this.callParty(RemoteMethods.AskElectionPermission, {election: this.lastElection+1});
    // console.log(`election ${this.lastElection+1} permission responses`, responses);
    return responses.length+1 >= this.TssPlugin.TSS_THRESHOLD && responses.findIndex(res => res !== true) < 0;
  }

  async informElectionReady() {
    let electionKey = this.TssPlugin.keys[this.getElectionId(this.lastElection+1)];

    let partners = electionKey.partners
      .map(w => this.TssPlugin.tssParty.onlinePartners[w])
      .filter(p => p.wallet !== process.env.SIGN_WALLET_ADDRESS)

    let responses = await this.callParty(RemoteMethods.ElectionResultReady, {election: this.lastElection+1}, partners)
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
    console.log(`********* leader[${this.lastElection}] is now ${this.leader} *********`);
  }

  waitToLeaderSelect() {
    return this._leaderSelectPromise.promise;
  }

  get onlinePartners() {
    return Object.values(this.TssPlugin.tssParty.onlinePartners)
      .filter(p => p.wallet !== process.env.SIGN_WALLET_ADDRESS)
  }

  async callParty(method, data={}, partners){
    if(partners === undefined)
      partners = this.onlinePartners
    return Promise.all(partners.map(p => {
      return this.remoteCall(
        p.peer,
        method,
        data
      ).catch(e => 'error')
    }))
  }

  @remoteMethod(RemoteMethods.AskElectionPermission)
  async _askElectionPermission(data={}, callerInfo) {
    // console.log('GroupLeaderPlugin.AskElectionPermission', {data, callerInfo});
    let {election} = data;
    return this.isWalletPermittedToElect(callerInfo.wallet, election)
  }

  @remoteMethod(RemoteMethods.ElectionStart)
  async _ElectionStart(data={}, callerInfo) {
    let {election} = data
    let permitted = this.isWalletPermittedToElect(callerInfo.wallet, election)
    /**
     * Next election start should call after at least 15 seconds.
     * if called immediately, two nodes may get permission to do election
     */
    if(permitted && this._electionStartedAt < Date.now()-15000){
      this._electionStartedAt = Date.now();
      return true
    }
    return false;
  }

  @remoteMethod(RemoteMethods.ElectionResultReady)
  async _electionResultReady(data={}, callerInfo) {
    // console.log('GroupLeaderPlugin.ElectionResultReady', {data, callerInfo});
    let {election} = data;
    let permitted = this.isWalletPermittedToElect(callerInfo.wallet, election);
    if(permitted){
      let key = this.TssPlugin.keys[this.getElectionId(election)];
      await key.waitToFulfill();
      this._electionComplete(key);
      return true;
    }
    return permitted;
  }

  @remoteMethod(RemoteMethods.WhoIsLeader)
  async _whoIsLeader(data={}, callerInfo) {
    let {leader, lastElection} = this;
    return {lastElection, leader};
  }
}

module.exports = GroupLeaderPlugin;
