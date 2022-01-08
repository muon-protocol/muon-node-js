const {utils: {BN, toBN, randomHex, sha3, soliditySha3, keccak256}} = require('web3')
const {range} = require('lodash');

module.exports = {
  BN,
  toBN,
  sha3,
  soliditySha3,
  keccak256,
  range,
  randomHex,
  ZERO: toBN(0),
  ONE: toBN(1),
}
