const mongoose = require('mongoose');
const {strToCID} = require('./common')
const Request = require('../../gateway/models/Request')
const Signature = require('../../gateway/models/Signature')
const {getTimestamp} = require('../helpers')
const crypto = require('../crypto')

function signRequest(request, priceResult) {
  let signTimestamp = getTimestamp()
  let signature = crypto.signRequest(request._id, signTimestamp, request.data.price)

  let sign = {
    request: request._id,
    owner: process.env.SIGN_WALLET_ADDRESS,
    timestamp: signTimestamp,
    data: {
      price: request.data.price
    },
    signature: signature
  }
  return sign
}

function getRequestInfo(requestId) {
  return Request.findOne({_id: mongoose.Types.ObjectId(requestId)})
}

function recoverSignature(request, signature){
  let signer = crypto.recoverRequestSignature(
    signature['request'],
    signature['timestamp'],
    request['data']['price'],
    signature['signature']
  )
  return signer
}

async function createCID(request) {
  return strToCID(`${process.env.PEER_ID}${request._id}`);
}

module.exports = {
  signRequest,
  getRequestInfo,
  recoverSignature,
  createCID,
}
