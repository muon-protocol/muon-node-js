const { axios, toBaseUnit, soliditySha3, BN, multiCall } = MuonAppUtils

const SpriteVWAP = require('./spirit_permissionless_oracles_vwap_v2')

const APP_CONFIG = {
  chainId: 250
}

module.exports = {
  ...SpriteVWAP,

  APP_NAME: 'solidly_permissionless_oracles_vwap_v2',
  APP_ID: 26,
  config: APP_CONFIG
}
