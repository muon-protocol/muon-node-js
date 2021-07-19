const ethers = require('ethers')
const Web3 = require('web3')
const BN = Web3.utils.BN
const web3 = new Web3();
const PRIVATE_KEY = process.env.SIGN_WALLET_PRIVATE_KEY
const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY)
web3.eth.accounts.wallet.add(account)

function signRequest(requestId, timestamp, price) {
  let idBn = web3.utils.toBN(`0x${requestId}`)
  let tsBn = web3.utils.toBN(timestamp.toString())
  let priceBN = web3.utils.toBN(web3.utils.toWei(price.toString()))

  let hash = getMessageHash(idBn, tsBn, priceBN)
  let sig = web3.eth.accounts.sign(hash, PRIVATE_KEY)

  // console.log("account: ", account.address)
  // console.log("requestId: ", toFixedHex(idBn))
  // console.log("timestamp: ", toFixedHex(tsBn))
  // console.log("price: ", toFixedHex(priceBN))
  // console.log("sig : ", sig.signature)

  return sig.signature;
}

function recoverRequestSignature(requestId, timestamp, price, signature) {
  let idBn = web3.utils.toBN(`0x${requestId}`)
  let tsBn = web3.utils.toBN(timestamp.toString())
  let priceBN = web3.utils.toBN(web3.utils.toWei(price.toString()))

  let hash = getMessageHash(idBn, tsBn, priceBN)
  let signer = web3.eth.accounts.recover(hash, signature)

  return signer;
}

function getMessageHash(requestId, timestamp, price){
  return web3.utils.soliditySha3(
    { type: 'bytes32', value: toFixedHex(requestId) },
    { type: 'bytes32', value: toFixedHex(timestamp) },
    { type: 'bytes32', value: toFixedHex(price)}
  );
}

function hashCallOutput(address, method, abi, result, outputFilter=[]){
  let methodAbi = abi.find(({name, type}) => (name===method && type === 'function'))
  if(!methodAbi) {
    throw {message: `Abi of method (${method}) not found`}
  }
  let abiOutputs = methodAbi.outputs
  if(outputFilter.length > 0){
    abiOutputs = outputFilter.map(key => {
      return methodAbi.outputs.find(({name}) => (name===key))
    })
  }
  // console.log('signing:',abiOutputs)
  let params = abiOutputs.map(({name, type}) => ({type, value: (!name || typeof result === "string") ?  result : result[name]}))
  params = [{type: 'address', value: address}, ...params]
  let hash = web3.utils.soliditySha3(...params)
  return hash;
}

function signCallOutput(address, method, abi, result, outputFilter=[]){
  let hash = hashCallOutput(address, method, abi, result, outputFilter);
  let sig = web3.eth.accounts.sign(hash, PRIVATE_KEY)
  return sig.signature;
}

function recoverCallOutputSignature(address, method, abi, result, outputFilter=[], signature){
  let hash = hashCallOutput(address, method, abi, result, outputFilter)
  let signer = web3.eth.accounts.recover(hash, signature)
  return signer;
}

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

function signString(string){
  let sig = web3.eth.accounts.sign(string, PRIVATE_KEY)
  return sig.signature;
}

function recoverStringSignature(str, sig){
  let signer = web3.eth.accounts.recover(str, sig)
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

module.exports = {
  signRequest,
  recoverRequestSignature,
  signString,
  hashCallOutput,
  signCallOutput,
  soliditySha3,
  sign,
  recover,
  recoverCallOutputSignature,
  recoverStringSignature,
  toBaseUnit,
}
