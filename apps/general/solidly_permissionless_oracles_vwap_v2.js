const { axios, toBaseUnit, soliditySha3, BN, multiCall } = MuonAppUtils

const ParentOraclesV2 = require('./parent_oracles_v2')

const APP_CONFIG = {
  chainId: 250
}

module.exports = {
  ...ParentOraclesV2,

  APP_NAME: 'solidly_permissionless_oracles_vwap_v2',
  APP_ID: 26,
  config: APP_CONFIG
}
