import Web3 from 'web3'
import {hashCallOutput} from './eth.js'
import crypto from "crypto"
import BN from "bn.js";
import {muonSha3} from './sha3.js'



const web3 = new Web3('http://localhost:8545');
let PRIVATE_KEY = process.env.SIGN_WALLET_PRIVATE_KEY;
if (PRIVATE_KEY) {
  const account = web3.eth.accounts.privateKeyToAccount("0x" + PRIVATE_KEY)
  web3.eth.accounts.wallet.add(account)
}

function sign(hash) {
  let sig = web3.eth.accounts.sign(hash, "0x" + PRIVATE_KEY)
  return sig.signature;
}

function recover(hash, signature) {
  let signer = web3.eth.accounts.recover(hash, signature)
  return signer;
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
  if (comps.length > 2) {
    throw new Error('Too many decimal points');
  }

  let whole = comps[0], fraction = comps[1];

  if (!whole) {
    whole = '0';
  }
  if (!fraction) {
    fraction = '0';
  }
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

const AES_ENCRYPTION_ALGORITHM = "aes-256-gcm"

export function aesCreateIv(random, privateKey) {
  return muonSha3(
    {t: 'uint256', v: '0x' + privateKey},
    {t: 'uint128', v: '0x' + random}
  ).substr(2, 32)
}

export function aesEncrypt(message, privateKey) {
  const random = crypto.randomBytes(16).toString('hex')
  const iv = aesCreateIv(random, privateKey);
  const initVector = Buffer.from(iv, 'hex')
  const Securitykey = Buffer.from(privateKey, "hex");
  const cipher = crypto.createCipheriv(AES_ENCRYPTION_ALGORITHM, Securitykey, initVector);

  return random
    + ":"
    + cipher.update(message, "utf-8", "hex")
    + cipher.final('hex')
    + ":" + cipher.getAuthTag().toString('hex')
}

export function aesDecrypt(encrypted, privateKey) {
  const [random, encryptedData, authTag] = encrypted.split(':')
  const iv = aesCreateIv(random, privateKey);
  const initVector = Buffer.from(iv, 'hex')
  const Securitykey = Buffer.from(privateKey, "hex");
  const decipher = crypto.createDecipheriv(AES_ENCRYPTION_ALGORITHM, Securitykey, initVector);
  decipher.setAuthTag(Buffer.from(authTag, 'hex'))

  return decipher.update(encryptedData, "hex", "utf-8")
    + decipher.final("utf8")
}

export function isAesEncrypted(cipher) {
  return cipher.split(':').length === 3
}

export {
  hashCallOutput,
  sign,
  recover,
  toBaseUnit,
}
