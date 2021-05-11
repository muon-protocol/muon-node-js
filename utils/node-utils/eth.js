const Web3 = require('web3')
const CID = require('cids')
const multihashing = require('multihashing-async')
const {flattenObject, sortObject, getTimestamp} = require('../helpers')
const crypto = require('../crypto')

const provider = new Web3.providers.HttpProvider(`https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`)
const web3 = new Web3(provider);

function getTransaction(txHash){
  return web3.eth.getTransaction(txHash)
}

function getTransactionReceipt(txHash){
  return web3.eth.getTransactionReceipt(txHash)
}

function call(contractAddress, methodName, params, abi){
  let contract = new web3.eth.Contract(abi, contractAddress);
  return contract.methods[methodName](...params).call();
}

function getCallData(contractAddress, method, params, abi) {
  let contract = new web3.eth.Contract(abi, contractAddress);
  return contract.methods[method](...params).encodeABI();
}

function isEqualObject(obj1, obj2) {
  return objectToStr(obj1) === objectToStr(obj2);
}

function isEqualCallResult(request, callResult) {
  let {method, abi, outputs} = request.data.callInfo;
  let hash1 = crypto.hashCallOutput(abi, method, request.data.result, outputs)
  let hash2 = crypto.hashCallOutput(abi, method, callResult, outputs)

  return hash1 == hash2
}

function objectToStr(obj){
  let flatData = flattenObject(obj)
  flatData = sortObject(flatData)
  return JSON.stringify(flatData)
}

function signRequest(request, result){
  let signature = null
  let signTimestamp = getTimestamp()

  switch (request.method) {
    case 'call':
      let {abi, method, outputs} = request.data.callInfo
      signature = crypto.signCallOutput(abi, method,request.data.result, outputs)
      break;
    default:
      throw {message: `Unknown eth app method: ${request.method}`}
  }

  return {
    request: request._id,
    owner: process.env.SIGN_WALLET_ADDRESS,
    timestamp: signTimestamp,
    data: result,
    signature,
  }
}

function recoverSignature(request, sign){
  let signer = null
  switch (request.method) {
    case 'call':
      let {abi, method, outputs} = request.data.callInfo
      signer = crypto.recoverCallOutputSignature(abi, method, request.data.result, outputs, sign.signature)
      break;
    default:
      throw {message: `Unknown eth app method: ${request.method}`}
  }

  return signer;
}

async function createCID(request) {
  const bytes = new TextEncoder('utf8').encode(JSON.stringify(request))

  const hash = await multihashing(bytes, 'sha2-256')
  const cid = new CID(0, 'dag-pb', hash)
  return cid.toString()
}

module.exports = {
  getTransaction,
  getTransactionReceipt,
  call,
  isEqualObject,
  isEqualCallResult,
  signRequest,
  recoverSignature,
  createCID,
}
