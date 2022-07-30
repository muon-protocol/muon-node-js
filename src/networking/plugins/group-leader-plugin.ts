import CallablePlugin from './base/callable-plugin'
import DistributedKey from '../../core/plugins/tss-plugin/distributed-key'
import {remoteApp, remoteMethod} from './base/app-decorators'
const tssModule = require('../../utils/tss')
const {timeout} = require('../../utils/helpers');
import TimeoutPromise from '../../common/timeout-promise'
const {utils:{soliditySha3}} = require('web3')
const CoreIpc = require('../../core/ipc')
import { OnlinePeerInfo } from '../types'
import { RemoteCallOptions } from './remote-call'

const RemoteMethods = {
  AskElectionPermission: "AskElectionPermission",
  ElectionStart: "ElectionStart",
  ElectionResultReady: 'ElectionResultReady',
  WhoIsLeader: 'WhoIsLeader',
}

@remoteApp
class GroupLeaderPlugin extends CallablePlugin {
  // TODO: How about adversarial behavior?

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
  electionKey: DistributedKey | null = null
  /**
   * Address of leader that win the election
   * @type {null}
   */
  leader: string | null = null;
  /**
   * Promise that fulfilled at the end of election.
   * @type {TimeoutPromise}
   * @private
   */
  _leaderSelectPromise = new TimeoutPromise();

  async onStart() {
    super.onStart();

    if(this.collateralPlugin.isLoaded){
      this._checkStatus();
    }
    else{
      this.collateralPlugin.once('loaded', this._checkStatus.bind(this))
    }
    this.network.on('peer:disconnect', this.onPeerDisconnect.bind(this));
  }

  onPeerDisconnect(peerId) {
    let peerIdStr = peerId.toB58String()
    if(!!this.leader){
      let leaderPeerIdStr = this.collateralPlugin.getWalletPeerId(this.leader);
      if(peerIdStr === leaderPeerIdStr){
        console.log(`Leader disconnect and need to reselect another leader.`)
        this.reselectLeader();
      }
      else{
        // @tss-ignore
        let onlineNodes = this.onlinePartners.map(p => p.wallet).filter(w => w!==peerIdStr);
        if(onlineNodes.length+1 < this.collateralPlugin.TssThreshold){
          console.log(`No enough online nodes. The leader will be cleared to select it again.`)
          this.reselectLeader();
        }
      }
    }
  }

  reselectLeader() {
    this.leader = null;
    setTimeout(this._checkStatus.bind(this), 5000);
  }

  get collateralPlugin(){
    return this.network.getPlugin('collateral');
  }

  async _checkStatus(){
    if(this.collateralPlugin.hasEnoughPartners()) {
      let leader = await this.leaderAlreadySelected();
      if (!!leader && !this.leader) {
        console.log(`leader already selected: `, leader)
        this.leader = leader;
        this._leaderSelectPromise.resolve(leader);
        return;
      }

      try {
        // console.log("GroupLeaderPlugin._checkStatus", Date.now()) // is failed: 000
        let permitted = await this.isPermittedToDoElection();
        if (permitted) {
          let started = await this.electionStart();
          if (started)
            this._electionStartedAt = Date.now();
          else
            throw {message: "Election start failed."}

          console.log(`** Got permission to do election **`);
          // this.electionKey = await this.TssPlugin.keyGen(null, {timeout: 45000});
          this.electionKey = await CoreIpc.generateTssKey();
          let done = await this.informElectionReady();
          if (done) {
            console.log(`Election complete successfully`);
            this._electionComplete(this.electionKey);
            return;
          } else {
            console.log(`Election confirmation failed.`);
          }
        } else
          console.log(`Not permitted to do election.`);
      } catch (e) {
        console.log('GroupLeaderPlugin._checkStatus', 'error', e)
      }
    }
    else {
      console.log(`No enough partners to find leader.`)
    }
    if(!this.leader)
      setTimeout(this._checkStatus.bind(this), 32000)
  }

  async electionStart() {
    // @ts-ignore
    let responses = await this.callParty(RemoteMethods.ElectionStart);
    // console.log(`GroupLeaderPlugin.electionStart electionStart responses:`, responses)
    let allDone = responses.findIndex(r => (r!==true)) < 0;
    // TODO: is need to 50% of nodes agree with election start?
    return allDone && (responses.length + 1) >= this.collateralPlugin.TssThreshold
  }

  // TODO: if all nodes except leader restart, then leader cannot be select
  async leaderAlreadySelected(): Promise<string | null>{
    // @ts-ignore
    let responses = await this.callParty(RemoteMethods.WhoIsLeader)
    let leaderCount = responses
      .filter(r => !!r?.leader)
      .map(r => `${r.leader}`)
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
    let leader = Object.keys(leaderCount)[0];
    if(leaderCount[leader] >= this.collateralPlugin.TssThreshold){
      return leader;
    }
    else
      return null;
  }

  get TssPlugin() {
    return this.network.getPlugin('tss-plugin')
  }

  async isPermittedToDoElection() {
    // @ts-ignore
    let responses = await this.callParty(RemoteMethods.AskElectionPermission);
    console.log('Current executor:', this.currentExecutor)
    console.log(`election permission responses`, responses);
    return responses.length+1 >= this.collateralPlugin.TssThreshold && responses.findIndex(res => res !== 'YES') < 0;
  }

  async informElectionReady() {

    // let partners = this.electionKey.partners
    //   .map(w => this.TssPlugin.tssParty.onlinePartners[w])
    //   .filter(p => p.wallet !== process.env.SIGN_WALLET_ADDRESS)
    if(this.electionKey === null)
      throw {message: "Election key is null."}
    // @ts-ignore
    let partners = this.electionKey.partners
      .filter(w => w !== process.env.SIGN_WALLET_ADDRESS)
      .map(w => this.collateralPlugin.getWalletPeerId(w))
      .map(peerId => this.collateralPlugin.onlinePeers[peerId])

    let responses = await this.callParty(
      RemoteMethods.ElectionResultReady,
      {electionKey: this.electionKey.id},
      partners
    )
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

  isLeader(wallet){
    return this.leader === wallet;
  }

  isWalletPermittedToElect(wallet) {
    return !this.leader && this.currentExecutor === wallet;
  }

  _electionComplete(key) {
    this.electionKey = key;
    this.leader = this.extractLeaderFromKey(key);
    this.emit('leader-change', this.leader);
    CoreIpc.fireEvent({type: "leader:select", data: this.leader});
    this._leaderSelectPromise.resolve(this.leader);
    if(this.leader === process.env.SIGN_WALLET_ADDRESS)
      console.log(`********* I am the leader now *********`);
    else
      console.log(`********* leader is now ${this.leader} *********`);
  }

  waitToLeaderSelect() {
    return this._leaderSelectPromise.promise;
  }

  get onlinePartners(): OnlinePeerInfo[] {
    // return Object.values(this.TssPlugin.tssParty.onlinePartners)
    //   .filter(p => p.wallet !== process.env.SIGN_WALLET_ADDRESS)

    // @ts-ignore
    return Object.values(this.collateralPlugin.onlinePeers)
    // @ts-ignore
      .filter(p => p.wallet !== process.env.SIGN_WALLET_ADDRESS)
  }

  get currentExecutor() {
    let walletList = [
      process.env.SIGN_WALLET_ADDRESS,
      ...this.onlinePartners.map(p =>p.wallet)
    ]
    let time = Math.floor(Date.now() / 100000)
    // let hashes = walletList.map(w => sha3(`${w.toLowerCase()}-${time}`));
    let hashes = walletList.map(w => soliditySha3({t:"address", v: w}, {t: 'uint32', v: time}));
    let minIndex = hashes.reduce((min, val, index, arr)=>(val<arr[min]?index:min), 0);
    return walletList[minIndex]
  }

  async callParty(method, data={}, partners, options?:RemoteCallOptions){
    if(partners === undefined)
      partners = this.onlinePartners
    return Promise.all(partners.map(p => {
      return this.remoteCall(
        p.peer,
        method,
        data,
        options
      ).catch(e => {
        console.log(e)
        return 'error'
      })
    }))
  }

  @remoteMethod(RemoteMethods.AskElectionPermission)
  async _askElectionPermission(data={}, callerInfo) {
    // console.log('GroupLeaderPlugin.AskElectionPermission', {data, callerInfo});
    return this.isWalletPermittedToElect(callerInfo.wallet) ? 'YES' : "NO";
  }

  @remoteMethod(RemoteMethods.ElectionStart)
  async _ElectionStart(data={}, callerInfo) {
    let permitted = this.isWalletPermittedToElect(callerInfo.wallet)
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
    let permitted = this.isWalletPermittedToElect(callerInfo.wallet);
    if(permitted){
      // let key = this.TssPlugin.getSharedKey(data.electionKey);
      // await key.waitToFulfill();
      // @ts-ignore
      let pid = await this.network.getPlugin('ipc-handler').getTaskProcess(`keygen-${data.electionKey}`)
      // @ts-ignore
      let key = await CoreIpc.getTssKey(data.electionKey, {pid});
      this._electionComplete(key);
      return true;
    }
    return permitted;
  }

  @remoteMethod(RemoteMethods.WhoIsLeader)
  async _whoIsLeader(data={}, callerInfo) {
    let {leader} = this;
    return {leader};
  }
}

export default GroupLeaderPlugin;
