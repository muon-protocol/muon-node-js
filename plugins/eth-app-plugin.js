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
    let {address, method, params = [], abi, outputs=[], network="eth"} = data;

    if (!address)
      throw {message: 'Invalid contract "address"'}

    if (!method)
      throw {message: 'Invalid contract method name'}

    if (!abi)
      throw {message: 'Invalid contract method abi'}

    if(!Array.isArray(outputs))
      throw {message: 'Outputs should be an array'}

    let result = await NodeUtils.eth.call(address, method, params, abi, network)

    let startedAt = getTimestamp();
    let newRequest = new Request({
      app: 'eth',
      method: 'call',
      owner: process.env.SIGN_WALLET_ADDRESS,
      peerId: process.env.PEER_ID,
      data: {
        callInfo: {address, method, params, abi, outputs, network},
        result
      },
      startedAt,
    })
    newRequest.save()

    let sign = await NodeUtils.eth.signRequest(newRequest, result);
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

    return requestData
  }

  @gatewayMethod('addBridgeToken')
  async onAddToken(data) {
    let {mainTokenAddress, mainNetwork, targetNetwork} = data;

    let result = {
      token: await NodeUtils.eth.getTokenInfo(mainTokenAddress, mainNetwork),
      tokenId: mainTokenAddress,
    }

    let startedAt = getTimestamp();
    let newRequest = new Request({
      app: 'eth',
      method: 'addBridgeToken',
      owner: process.env.SIGN_WALLET_ADDRESS,
      peerId: process.env.PEER_ID,
      data: {
        input: {mainTokenAddress, mainNetwork, targetNetwork},
        result
      },
      startedAt,
    })
    newRequest.save()

    let sign = await NodeUtils.eth.signRequest(newRequest, result);
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

    return requestData
  }

  async isVerifiedRequest(request){
    let actualResult=null, verified=true;
    switch (request.method) {
      case 'call': {
        let {callInfo: {address, method, params, abi, network, outputs}, result} = request.data;
        actualResult = await NodeUtils.eth.call(address, method, params, abi, network)
        break;
        // let hash1 = crypto.hashCallOutput(address, method, abi, actualResult, outputs);
        // let hash2 = crypto.hashCallOutput(address, method, abi, result, outputs);
        // // console.log({result, actualResult, hash1, hash2})
        // return [hash1 === hash2, result, actualResult];
      }
      case 'addBridgeToken': {
        let {input: {mainTokenAddress, mainNetwork, targetNetwork}, result} = request.data;
        actualResult = {
          token: await NodeUtils.eth.getTokenInfo(mainTokenAddress, mainNetwork),
          tokenId: mainTokenAddress,
        }
        break;
        // let hash1 = crypto.soliditySha3([
        //   {type: 'uint256', value: actualResult.tokenId},
        //   {type: 'string', value: actualResult.token.name},
        //   {type: 'string', value: actualResult.token.symbol},
        //   {type: 'uint8', value: actualResult.token.decimals},
        // ]);
        // let hash2 = crypto.soliditySha3([
        //   {type: 'uint256', value: result.tokenId},
        //   {type: 'string', value: result.token.name},
        //   {type: 'string', value: result.token.symbol},
        //   {type: 'uint8', value: result.token.decimals},
        // ]);
        // // console.log({result, actualResult, hash1, hash2})
        // return [hash1 === hash2, result, actualResult];
      }
    }
    if(actualResult){
      let hash1 = this.hashRequestResult(request, request.data.result);
      let hash2 = this.hashRequestResult(request, actualResult);
      verified = hash1 === hash2
    }
    return [verified, request.data.result, actualResult]
  }

  hashRequestResult(request, result) {
    switch (request.method) {
      case 'call': {
        let {address, method, abi, outputs} = request.data.callInfo;
        return crypto.hashCallOutput(address, method, abi, result, outputs)
      }
      case 'addBridgeToken': {
        let {token, tokenId} = result;
        return crypto.soliditySha3([
          {type: 'uint256', value: tokenId},
          {type: 'string', value: token.name},
          {type: 'string', value: token.symbol},
          {type: 'uint8', value: token.decimals},
        ]);
      }
      default:
        return null;
    }
  }

  recoverSignature(request, sign) {
    let {data:result, signature} = sign
    let hash = this.hashRequestResult(request, result);
    return crypto.recover(hash, signature);
    // return NodeUtils.eth.recoverSignature(request, signature)
  }

  async processRemoteRequest(request) {
    let result = null;
    switch (request.method) {
      case 'call': {
        let {address, method, params, abi, network} = request.data.callInfo;
        result = await NodeUtils.eth.call(address, method, params, abi, network)
        break;
      }
      case 'addBridgeToken':{
        let {mainTokenAddress, mainNetwork, targetNetwork} = request.data.input;
        result = {
          token: await NodeUtils.eth.getTokenInfo(mainTokenAddress, mainNetwork),
          tokenId: mainTokenAddress,
        }
        break;
      }
    }
    let hash1 = this.hashRequestResult(request, request.data.result);
    let hash2 = this.hashRequestResult(request, result);
    if (hash1 === hash2) {
      // let sign = await NodeUtils.eth.signRequest(request, result)
      // return sign
      return this.makeSignature(request, result, hash2);
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

