const BaseApp = require('./base/base-app-plugin')
const Request = require('../gateway/models/Request')
const Signature = require('../gateway/models/Signature')
const NodeUtils = require('../utils/node-utils')
const crypto = require('../utils/crypto')
const {omit} = require('lodash')
const {getTimestamp} = require('../utils/helpers')
const {remoteApp, remoteMethod, gatewayMethod} = require('./base/app-decorators')

@remoteApp
class EthAppPlugin extends BaseApp {
  APP_BROADCAST_CHANNEL = 'muon/eth/request/broadcast'
  APP_NAME = 'eth'

  constructor(...args) {
    super(...args);
  }

  @gatewayMethod('test')
  async onTest(data){
    let address = '0x56040d44f407fa6f33056d4f352d2e919a0d99fb'
    let contractAbi = [{
      "constant": true,
      "inputs": [
        {"name": "owner", "type": "address"},
        {"name": "index", "type": "uint256"}
      ],
      "name": "getLand",
      "outputs": [
        {"name": "x1", "type": "int256"},
        {"name": "y1", "type": "int256"},
        {"name": "x2", "type": "int256"},
        {"name": "y2", "type": "int256"},
        {"name": "time", "type": "uint256"},
        {"name": "hash", "type": "string"}
      ],
      "payable": false,
      "stateMutability": "view",
      "type": "function"
    }]

    const sampleResult = {
      "0": "-240",
      "1": "-130",
      "2": "-80",
      "3": "-40",
      "4": "1603218941",
      "5": "QmPUiCAVn5Qie3NmfMrppP6HDrAd5voKeVX8a7MYhqJa9a",
      "x1": "-240",
      "y1": "-130",
      "x2": "-80",
      "y2": "-40",
      "time": "1603218941",
      "hash": "QmPUiCAVn5Qie3NmfMrppP6HDrAd5voKeVX8a7MYhqJa9a"
    }
    return {
      sign: crypto.signCallOutput(address, 'getLand', contractAbi, sampleResult)
    };
  }

  @gatewayMethod('call')
  async onCall(data) {
    let {address, method, params = [], abi, outputs=[]} = data;

    if (!address)
      throw {message: 'Invalid contract "address"'}

    if (!method)
      throw {message: 'Invalid contract method name'}

    if (!abi)
      throw {message: 'Invalid contract method abi'}

    if(!Array.isArray(outputs))
      throw {message: 'Outputs should be an array'}

    let result = await NodeUtils.eth.call(address, method, params, abi)

    let startedAt = getTimestamp();
    let newRequest = new Request({
      app: 'eth',
      method: 'call',
      owner: process.env.SIGN_WALLET_ADDRESS,
      peerId: process.env.PEER_ID,
      data: {
        callInfo: {address, method, params, abi, outputs},
        result
      },
      startedAt,
    })
    newRequest.save()

    let sign = NodeUtils.eth.signRequest(newRequest, result);
    (new Signature(sign)).save();

    this.broadcastNewRequest(newRequest);

    let [confirmed, signatures] = await this.isOtherNodesConfirmed(newRequest, parseInt(process.env.NUM_SIGN_TO_CONFIRM))

    if(confirmed){
      newRequest['confirmedAt'] = getTimestamp()
    }

    let requestData = {
      confirmed,
      ...omit(newRequest._doc, ['__v']),
      signatures,
    }

    if (confirmed) {
      newRequest.save()
      await this.emit('request-signed', requestData)
    }

    return {
      cid: await NodeUtils.eth.createCID(requestData),
      ...requestData
    }
  }

  recoverSignature(request, signature) {
    return NodeUtils.eth.recoverSignature(request, signature)
  }

  async processRemoteRequest(request) {
    let {address, method, params, abi} = request.data.callInfo;
    let callResult = await NodeUtils.eth.call(address, method, params, abi)
    if (NodeUtils.eth.isEqualCallResult(request, callResult)) {
      let sign = NodeUtils.eth.signRequest(request, callResult)
      return sign
    } else {
      throw {message: "Request not confirmed"}
    }
  }

  // @remoteMethod('request-sign')
  // async responseToRemoteRequestSign(sig){
  //   console.log('RemoteCall.requestSign', sig)
  //   let signer = NodeUtils.eth.recoverSignature(sig);
  //   if(signer && signer === sig.owner) {
  //     let newSignature = new Signature(sig)
  //     await newSignature.save();
  //   }
  // }
}

module.exports = EthAppPlugin

