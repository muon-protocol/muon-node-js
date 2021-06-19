const ethers = require('ethers')
const Web3 = require('web3')
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
  let params = abiOutputs.map(({name, type}) => ({type, value: !!name ? result[name] : result}))
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
}
