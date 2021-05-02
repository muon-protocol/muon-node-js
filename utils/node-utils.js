mongoose = require('mongoose');
const Request = require('../gateway/models/Request')
const Signature = require('../gateway/models/Signature')
const {getTimestamp} = require('./helpers')
const crypto = require('./crypto')

function signRequest(request, save=true) {
  return Promise.resolve(true)
    .then(() => {
      let signTimestamp = getTimestamp()
      let signature = crypto.signRequest(request._id, signTimestamp, request['price'])

      let sign = {
        'request': request._id,
        "price": request['price'],
        "timestamp": signTimestamp,
        "owner": process.env.SIGN_WALLET_ADDRESS,
        "signature": signature
      }

      if(save) {
        let newSignature = new Signature(sign)
        return newSignature.save()
      }
      else
        return sign
    })
}

function getRequestInfo(requestId) {
  return Request.findOne({_id: mongoose.Types.ObjectId(requestId)})
}

function recoverSignature(signature){
  let signer = crypto.recoverRequestSignature(signature['request'], signature['timestamp'], signature['price'], signature['signature'])
  return signer
}

module.exports = {
  signRequest,
  getRequestInfo,
  recoverSignature,
}
