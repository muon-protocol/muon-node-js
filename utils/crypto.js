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

function toFixedHex(bigNum){
  return ethers.utils.hexZeroPad('0x' + bigNum.toString(16), 32);
}

module.exports = {
  signRequest,
  recoverRequestSignature,
}
