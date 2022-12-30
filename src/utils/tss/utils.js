import Web3 from 'web3'
import lodash from 'lodash'

const {range} = lodash
const {utils: {BN, toBN, randomHex, sha3, soliditySha3, keccak256}} = Web3;
const ZERO = toBN(0)
const ONE = toBN(1)

export {
  BN,
  toBN,
  sha3,
  soliditySha3,
  keccak256,
  range,
  randomHex,
  ZERO,
  ONE,
}
