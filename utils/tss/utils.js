const {utils: {BN, toBN, randomHex, sha3}} = require('web3')
const {range} = require('lodash');

module.exports = {
  BN,
  toBN,
  sha3,
  range,
  randomHex,
  ZERO: toBN(0),
  ONE: toBN(1),
}
