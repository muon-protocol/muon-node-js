const SpriteVWAP = require('./spirit_permissionless_oracles_vwap');

const APP_CONFIG = {
  chainId: 43114,
  graphUrl: "https://api.thegraph.com/subgraphs/name/traderjoe-xyz/exchange",
  graphDeploymentId: "QmW62QDNJriA73HeyDAwnEaFyDNLZc7o8m5ewSALDRedoM"
};

module.exports = {
  ...SpriteVWAP,

  APP_NAME: 'traderjoe_permissionless_oracles_vwap',
  APP_ID: 21,
  config: APP_CONFIG
}
