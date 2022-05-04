const SpriteVWAP = require('./spirit_permissionless_oracles_vwap_v2')
const APP_CONFIG = {}
module.exports = {
  ...SpriteVWAP,

  APP_NAME: 'sushi_permissionless_oracles_vwap_v2',
  APP_ID: 28,
  config: APP_CONFIG,

  VALID_CHAINS: ['1', '137', '42161', '43114', '250', '56'],

  prepareTokenTx: async function (pair, exchange) {
    const tokenTxs = await this.getTokenTxs(
      pair,
      this.graphUrl[exchange][this.config.chainId],
      this.graphDeploymentId[exchange][this.config.chainId]
    )
    return tokenTxs
  }
}
