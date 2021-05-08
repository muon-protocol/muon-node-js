const BaseApp = require('./base/base-app-plugin')
const Request = require('../gateway/models/Request')
const Signature = require('../gateway/models/Signature')
const NodeUtils = require('../utils/node-utils')
const {omit} = require('lodash')
const {remoteApp, remoteMethod, gatewayMethod} = require('./base/app-decorators')

@remoteApp
class EthAppPlugin extends BaseApp {
  APP_BROADCAST_CHANNEL = 'muon/eth/request/broadcast'
  APP_NAME = 'eth'

  constructor(...args) {
    super(...args);
  }


  @gatewayMethod('call')
  async onCall(data) {
    let {address, method, params = [], abi} = data;

    if (!address)
      throw {message: 'Invalid contract "address"'}

    if (!method)
      throw {message: 'Invalid contract method name'}

    if (!abi)
      throw {message: 'Invalid contract method abi'}

    let result = await NodeUtils.eth.call(address, method, params, abi)

    let startedAt = Date.now();
    let newRequest = new Request({
      app: 'eth',
      method: 'call',
      owner: process.env.SIGN_WALLET_ADDRESS,
      peerId: process.env.PEER_ID,
      data: {
        callInfo: {address, method, params, abi},
        result
      },
      startedAt,
    })
    newRequest.save()

    let sign = NodeUtils.eth.signRequest(newRequest);
    (new Signature(sign)).save()

    this.broadcastNewRequest({
      type: 'new_request',
      peerId: process.env.PEER_ID,
      _id: newRequest._id
    });

    let [confirmed, signatures] = await this.isOtherNodesConfirmed(newRequest, parseInt(process.env.NUM_SIGN_TO_CONFIRM))

    let requestData = {
      confirmed,
      ...omit(newRequest._doc, ['__v']),
      signatures,
    }

    if (confirmed) {
      newRequest['confirmedAt'] = Date.now()
      newRequest.save()
      await this.emit('request-signed', requestData)
    }

    return {
      cid: await NodeUtils.eth.createCID(requestData),
      ...requestData
    }
  }

  recoverSignature(signature) {
    return NodeUtils.eth.recoverSignature(signature)
  }

  async processRemoteRequest(request) {
    let {address, method, params, abi} = request.data.callInfo;
    let callResult = await NodeUtils.eth.call(address, method, params, abi)
    if (NodeUtils.eth.isEqualObject(callResult, request.data.result)) {
      return NodeUtils.eth.signRequest(request, callResult)
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

