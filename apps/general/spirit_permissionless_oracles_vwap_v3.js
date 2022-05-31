const ParentOraclesV3 = require('./parent_oracles_v3')

const APP_CONFIG = {
  chainId: 250
}

module.exports = {
  ...ParentOraclesV3,

  APP_NAME: 'spirit_permissionless_oracles_vwap_v3',
  APP_ID: 31,
  config: APP_CONFIG
}
