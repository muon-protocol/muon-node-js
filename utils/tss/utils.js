const {utils: {BN, toBN, randomHex}} = require('web3')

module.exports = {
  BN,
  toBN,
  randomHex,
  ZERO: toBN(0),
  ONE: toBN(1),
}
