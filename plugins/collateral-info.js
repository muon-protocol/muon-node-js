const BasePlugin = require('./base/base-plugin')
const ethUtil = require('../utils/node-utils/eth');
const GroupManagerABI = require('../data/GroupManager-ABI');

class CollateralInfoPlugin extends BasePlugin{

  config = null;
  groupInfo = null;
  networkInfo = null

  async onStart(){
    super.onStart();

    this.muon.once('peer', () => {
      this.loadCollateralInfo();
    })
  }

  async loadCollateralInfo(){
    let myWallet = process.env.SIGN_WALLET_ADDRESS;

    this.groupInfo = await this.contractCall('getNodeGroupInfo', [myWallet]);

    let _networkInfo = await this.contractCall('getNetworkInfo');

    // remove prefixed "_" from keys;
    this.networkInfo = Object.keys(_networkInfo).reduce((res, key) => {
      let keyWithout_ = key.startsWith('_') ? key.slice(1) : key
      res = {
        ...res,
        [keyWithout_]: _networkInfo[key]
      }
      return res;
    }, {});

    if(process.env.VERBOSE) {
      console.log('CollateralInfo.loadCollateralInfo: Info loaded.', {
        networkInfo: this.networkInfo,
        groupInfo: this.groupInfo
      });
    }

    // TODO: collateral info validation
    // TODO: when the current node is not part of any group.
    // TODO: update interval/watch network events.

    this.emit('loaded');
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
    return this.groupInfo.group;
  }

  get TssThreshold(){
    return this.networkInfo.tssThreshold;
  }

  get MinGroupSize(){
    return this.networkInfo.minGroupSize;
  }

  get MaxGroupSize(){
    return this.networkInfo.maxGroupSize;
  }
}

module.exports = CollateralInfoPlugin;
