import Web3 from 'web3'
import lodash from 'lodash'
import BN from 'bn.js';

const {range} = lodash
const {utils: {toBN, randomHex, sha3, soliditySha3, keccak256}} = Web3;
const ZERO = toBN(0)
const ONE = toBN(1)

function buf2bigint (buf: Uint8Array): bigint {
  let ret = BigInt(0)
  // @ts-ignore
  for (const i of (buf as Buffer).values()) {
    const bi = BigInt(i)
    ret = (ret << BigInt(8)) + bi
  }
  return ret
}

function bigint2hex(num: bigint, size: number = 32) {
  return '0x' + num.toString(16).padStart(size*2, '0')
}

function buf2str(buf: Uint8Array | Buffer) {
  let temp: Buffer = Buffer.from(buf)
  return temp.toString('hex')
}

export {
  buf2bigint,
  buf2str,
  bigint2hex,
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
