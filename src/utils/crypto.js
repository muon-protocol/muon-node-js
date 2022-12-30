import ethers from 'ethers'
import Web3 from 'web3'
import {hashCallOutput} from './eth.js'

const BN = Web3.utils.BN
const web3 = new Web3();
const PRIVATE_KEY = process.env.SIGN_WALLET_PRIVATE_KEY
const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY)
web3.eth.accounts.wallet.add(account)

function soliditySha3(params){
  return web3.utils.soliditySha3(...params);
}

function sign(hash) {
  let sig = web3.eth.accounts.sign(hash, PRIVATE_KEY)
  return sig.signature;
}

function recover(hash, signature){
  let signer = web3.eth.accounts.recover(hash, signature)
  return signer;
}

function toFixedHex(bigNum){
  return ethers.utils.hexZeroPad('0x' + bigNum.toString(16), 32);
}

function isString(s) {
  return (typeof s === 'string' || s instanceof String)
}

function toBaseUnit(value, decimals) {
  if (!isString(value)) {
    throw new Error('Pass strings to prevent floating point precision issues.')
  }
  const ten = new BN(10);
  const base = ten.pow(new BN(decimals));

  // Is it negative?
  let negative = (value.substring(0, 1) === '-');
  if (negative) {
    value = value.substring(1);
  }

  if (value === '.') {
    throw new Error(
      `Invalid value ${value} cannot be converted to`
      + ` base unit with ${decimals} decimals.`);
  }

  // Split it into a whole and fractional part
  let comps = value.split('.');
  if (comps.length > 2) { throw new Error('Too many decimal points'); }

  let whole = comps[0], fraction = comps[1];

  if (!whole) { whole = '0'; }
  if (!fraction) { fraction = '0'; }
  if (fraction.length > decimals) {
    throw new Error('Too many decimal places');
  }

  while (fraction.length < decimals) {
    fraction += '0';
  }

  whole = new BN(whole);
  fraction = new BN(fraction);
  let wei = (whole.mul(base)).add(fraction);

  if (negative) {
    wei = wei.neg();
  }

  return new BN(wei.toString(10), 10);
}

export {
  hashCallOutput,
  toFixedHex,
  soliditySha3,
  sign,
  recover,
  toBaseUnit,
}
