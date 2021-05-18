const Web3 = require('web3')
const HttpProvider = Web3.providers.HttpProvider;
const CID = require('cids')
const multihashing = require('multihashing-async')
const {flattenObject, sortObject, getTimestamp} = require('../helpers')
const crypto = require('../crypto')

const _networksWeb3 = {
  ganache: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_GANACHE)),
  eth: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_ETH)),
  ropsten: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_ROPSTEN)),
  rinkeby: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_RINKEBY)),
  bsc: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_BSC)),
  bsctest: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_BSCTEST)),
  ftm: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_FTM)),
  ftmtest: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_FTMTEST)),
}

function getWeb3(network) {
  if(_networksWeb3[network])
    return Promise.resolve(_networksWeb3[network])
  else
    return Promise.reject({message: `invalid network "${network}"`})
}

function getTransaction(txHash, network){
  return getWeb3(network).then(web3 => web3.eth.getTransaction(txHash))
}

function getTransactionReceipt(txHash, network){
  return getWeb3(network).then(web3 => web3.eth.getTransactionReceipt(txHash))
}

function call(contractAddress, methodName, params, abi, network){
  return getWeb3(network)
    .then(web3 => {
      let contract = new web3.eth.Contract(abi, contractAddress);
      return contract.methods[methodName](...params).call();
    })
}

function isEqualObject(obj1, obj2) {
  return objectToStr(obj1) === objectToStr(obj2);
}

function isEqualCallResult(request, callResult) {
  let {address, method, abi, outputs} = request.data.callInfo;
  let hash1 = crypto.hashCallOutput(address, method, abi, request.data.result, outputs)
  let hash2 = crypto.hashCallOutput(address, method, abi, callResult, outputs)

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
      let {abi, address, method, outputs} = request.data.callInfo
      signature = crypto.signCallOutput(address, method, abi,request.data.result, outputs)
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
      let {address, method, abi, outputs} = request.data.callInfo
      signer = crypto.recoverCallOutputSignature(address, method, abi, request.data.result, outputs, sign.signature)
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
