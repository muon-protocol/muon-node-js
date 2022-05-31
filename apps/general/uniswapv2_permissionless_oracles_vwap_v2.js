const ParentOraclesV2 = require('./parent_oracles_v2')

const APP_CONFIG = {
  chainId: 1
}

module.exports = {
  ...ParentOraclesV2,

  APP_NAME: 'uniswapv2_permissionless_oracles_vwap_v2',
  APP_ID: 29,
  config: APP_CONFIG,
  VALID_CHAINS: ['1']
}
