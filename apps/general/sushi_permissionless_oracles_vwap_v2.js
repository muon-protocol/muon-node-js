const SpriteVWAP = require('./spirit_permissionless_oracles_vwap_v2')
const {
  GRAPH_URL,
  GRAPH_DEPLOYMENT_ID
} = require('./spirit_permissionless_oracles_vwap_v2.constant.json')
const APP_CONFIG = {}
module.exports = {
  ...SpriteVWAP,

  APP_NAME: 'sushi_permissionless_oracles_vwap_v2',
  APP_ID: 28,
  config: APP_CONFIG,

  VALID_CHAINS: ['1', '137', '42161', '43114', '250', '56'],

  prepareTokenTx: async function (pair, exchange, start, end) {
    const tokenTxs = await this.getTokenTxs(
      pair,
      GRAPH_URL[exchange][this.config.chainId],
      GRAPH_DEPLOYMENT_ID[exchange][this.config.chainId],
      start,
      end
    )
    return tokenTxs
  }
}
