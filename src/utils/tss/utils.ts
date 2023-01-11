import Web3 from 'web3'
import lodash from 'lodash'
import BN from 'bn.js';

const {range} = lodash
const {utils: {toBN, randomHex, sha3, soliditySha3, keccak256}} = Web3;
const ZERO = toBN(0)
const ONE = toBN(1)

function pub2addr(publicKey) {
  let pubKeyHex = publicKey.encode('hex').substr(2);
  // @ts-ignore
  let pub_hash = keccak256(Buffer.from(pubKeyHex, 'hex'))
  return toChecksumAddress('0x' + pub_hash.substr(-40));
}

function toChecksumAddress(address) {
  address = address.toLowerCase().replace(/^0x/i, '')
  let hash = keccak256(address).replace(/^0x/i, '');
  let ret = '0x'
  for (let i = 0; i < address.length; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      ret += address[i].toUpperCase()
    } else {
      ret += address[i]
    }
  }
  return ret
}

function bn2hex(num: BN, byteLength: number=32): string {
  return '0x' + num.toBuffer('be', byteLength).toString('hex');
}

export {
  BN,
  toBN,
  bn2hex,
  sha3,
  soliditySha3,
  keccak256,
  range,
  pub2addr,
  randomHex,
  ZERO,
  ONE,
}
