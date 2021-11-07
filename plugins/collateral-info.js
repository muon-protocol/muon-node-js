const BasePlugin = require('./base/base-plugin')
const ethUtil = require('../utils/node-utils/eth');
const GroupManagerABI = require('../data/GroupManager-ABI');
const ERC20ABI = require('../data/ERC20-ABI');

class CollateralInfoPlugin extends BasePlugin{

  config = null;
  groupInfo = null;
  otherGroupsInfo = {}
  _groupWallets = {}
  _otherGroupWallets = {}
  networkInfo = null

  _eventSubscribe = null;

  async onStart(){
    super.onStart();

    this.muon.once('peer:connect', () => {
      // Listen to contract events and inform any changes.
      // TODO: uncomment this. (commented for debug)
      // this._watchContractEvents();

      this._loadCollateralInfo();
    })
  }

  get groupWallets() {
    return this._groupWallets
  }

  get otherGroupWallets() {
    return this._otherGroupWallets
  }

  async _loadCollateralInfo(){
    let myWallet = process.env.SIGN_WALLET_ADDRESS;

    this.groupInfo = await this.contractCall('getUserGroupInfo', [myWallet]);
    let _networkInfo = await this.contractCall('getNetworkInfo');
    // remove prefixed "_" from keys;
    this.networkInfo = Object.keys(_networkInfo).reduce((res, key) => {
      let keyWithout_ = key.startsWith('_') ? key.slice(1) : key
      res = {
        ...res,
        [keyWithout_]: _networkInfo[key]
      };
      return res;
    }, {});

    // load other groups info
    let lastGroupId = await this.contractCall('lastGroupId');
    for(let i=parseInt(lastGroupId) ; i>0 ; i--) {
      if(i.toString() === this.groupInfo.group.toString())
        continue;
      this.otherGroupsInfo[i.toString()] = await this.contractCall('getGroupInfo', [i]);
    }

    const arr2obj = arr => arr.reduce((obj, w) => (obj[w]=true, obj), {})
    this._groupWallets = arr2obj(this.groupInfo?.partners || [])
    this._otherGroupWallets = Object.values(this.otherGroupsInfo)
      .map(g => g.partners)
      .map(arr2obj)
      .reduce((acc, c) => ({...acc, ...c}), {});

    if(process.env.VERBOSE) {
      console.log('CollateralInfo._loadCollateralInfo: Info loaded.'
      //   , {
      //   networkInfo: this.networkInfo,
      //   groupInfo: this.groupInfo
      // }
      );
    }

    // TODO: collateral info validation
    // TODO: when the current node is not part of any group.
    // TODO: update interval/watch network events.

    this.emit('loaded');
  }

  _watchContractEvents() {
    this._eventSubscribe = ethUtil.subscribeLogEvent(
        this.Network,
        this.GroupManagerAddress,
        GroupManagerABI,
        'allEvents', // watch to all events
        15000, // request interval in seconds
        0 // no need to previews events
      );
    this._eventSubscribe.on('event', this._onRawEvent.bind(this));

    // let test = ethUtil.subscribeLogEvent(
    //     'eth',
    //     '0xdac17f958d2ee523a2206206994597c13d831ec7',
    //     ERC20ABI,
    //     'Transfer',
    //     10000
    //   );
    // test.on('event', this.onEvent.bind(this))
  }

  _onRawEvent(txs, network, contractAddress) {
    let importantEvents = ['AddPartner', 'DeletePartner'];
    let filteredEvents = {}
    txs.forEach(e => {
      if(importantEvents.includes(e.event)){
        if(filteredEvents[e.event] === undefined)
          filteredEvents[e.event] = [];
        filteredEvents[e.event].push(e)
      }
    })
    Object.keys(filteredEvents).forEach(name => {
      this.emit(`event:${name}`, filteredEvents[name]);
    })
    // console.log('event detected', txs, network, contractAddress)
  }

  onEvent(name, callback){
    this.on(`event:${name}`, callback);
  }

  getWallets(){
    // return this.muon.configs.net.collateralWallets;
    return this.groupInfo?.partners || [];
  }

  contractCall(methodName, params=[]) {
    return ethUtil.call(
      this.GroupManagerAddress,
      methodName,
      params,
      GroupManagerABI,
      this.Network
    );
  }

  get Network(){
    let collateralConfig = this.muon.configs.net.collateral;
    return collateralConfig.network
  }

  get GroupManagerAddress(){
    let collateralConfig = this.muon.configs.net.collateral;
    return collateralConfig.groupManager
  }

  get GroupId(){
    return this.groupInfo?.group;
  }

  get TssThreshold(){
    return this.networkInfo?.tssThreshold;
  }

  get MinGroupSize(){
    return this.networkInfo?.minGroupSize;
  }

  get MaxGroupSize(){
    return this.networkInfo?.maxGroupSize;
  }
}

module.exports = CollateralInfoPlugin;
