const mongoose = require('mongoose');
const CID = require('cids')
const multihashing = require('multihashing-async')
const Request = require('../../gateway/models/Request')
const Signature = require('../../gateway/models/Signature')
const {getTimestamp} = require('../helpers')
const crypto = require('../crypto')

function signRequest(request, priceResult) {
  let signTimestamp = getTimestamp()
  let signature = crypto.signRequest(request._id, signTimestamp, priceResult['price'])

  let sign = {
    request: request._id,
    owner: process.env.SIGN_WALLET_ADDRESS,
    timestamp: signTimestamp,
    data: {
      price: priceResult['price']
    },
    signature: signature
  }
  return sign
}

function getRequestInfo(requestId) {
  return Request.findOne({_id: mongoose.Types.ObjectId(requestId)})
}

function recoverSignature(signature){
  let signer = crypto.recoverRequestSignature(
    signature['request'],
    signature['timestamp'],
    signature['data']['price'],
    signature['signature']
  )
  return signer
}

async function createCID(request) {
  const bytes = new TextEncoder('utf8').encode(`${process.env.PEER_ID}${request._id}`)

  const hash = await multihashing(bytes, 'sha2-256')
  const cid = new CID(0, 'dag-pb', hash)
  return cid.toString()
}

module.exports = {
  signRequest,
  getRequestInfo,
  recoverSignature,
  createCID,
}
