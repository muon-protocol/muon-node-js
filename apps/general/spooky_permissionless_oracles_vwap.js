const SpriteVWAP = require('./spirit_permissionless_oracles_vwap')

const APP_CONFIG = {
  chainId: 250,
  graphUrl:
    'https://api.thegraph.com/subgraphs/name/shayanshiravani/spookyswap',
  graphDeploymentId: 'QmQnteZnJmshPHuUbYNxSCVTEyKunncwCUgYiyqEFQeDV7'
}

module.exports = {
  ...SpriteVWAP,

  APP_NAME: 'spooky_permissionless_oracles_vwap',
  APP_ID: 17,
  config: APP_CONFIG
}
