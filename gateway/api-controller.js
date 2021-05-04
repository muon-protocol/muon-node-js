const Sources = require('./sources')
const fs = require('fs')
const CID = require('cids');
const Request = require('./models/Request')
const Signature = require('./models/Signature')
const NodeUtils = require('../utils/node-utils');
const NodeCaller = require('./node-caller')
const {timeout, getTimestamp} = require('../utils/helpers')

module.exports.index = function (req, res, next) {
  res.json({
    status: 'API Its Working',
    message: 'Welcome to MUON protocol!'
  });
}

module.exports.getNewRequest = async (req, res, next) => {
  let {symbol, source = "finnhub"} = req.query || {}

  if (!symbol) {
    return res.json({
      success: false,
      message: "Missing symbol param",
    })
  }

  try {
    let startedAt = Date.now();
    let price = await Sources.getSymbolPrice(symbol, source)

    if (!price) {
      return res.json({
        "success": false,
        "symbol": symbol,
        "message": "Not found"
      })
    }
    let newRequest = new Request({
      "symbol": symbol,
      "price": price['price'],
      "timestamp": price['timestamp'],
      "peerId": process.env.PEER_ID,
      "owner": process.env.SIGN_WALLET_ADDRESS,
      "source": source,
      "rawPrice": price,
      startedAt,
    })
    let saveNewUser = await newRequest.save()

    await NodeUtils.signRequest(newRequest);

    NodeCaller.broadcast({
      type: 'new_request',
      peerId:  process.env.PEER_ID,
      id: newRequest._id
    })

    let secondsToCheck = 0
    let confirmed = false
    let allSignatures = []
    let signers = {}

    while(secondsToCheck < 5){
      await timeout(250);
      allSignatures = await Signature.find({request: newRequest._id})
      signers = {};
      for(let sig of allSignatures){
        let sigOwner = NodeUtils.recoverSignature(sig)
        if(sigOwner !== sig['owner'])
          continue;

        signers[sigOwner] = true;
      }

      if(Object.keys(signers).length >= parseInt(process.env.NUM_SIGN_TO_CONFIRM)){
        confirmed = true;
        newRequest['confirmedAt'] = Date.now()
        await newRequest.save()
        break;
      }
      secondsToCheck += 0.25
    }

    let requestData = {
      symbol,
      id: newRequest._id,
      price: price['price'],
      creator: process.env.SIGN_WALLET_ADDRESS,
      signatures: allSignatures.filter(sig => Object.keys(signers).includes(sig['owner'])).map(sig => ({
        "owner": sig['owner'],
        "timestamp": sig['timestamp'],
        "price": sig['price'],
        "signature": sig['signature'],
      })),
      startedAt: startedAt,
      confirmedAt: newRequest.confirmedAt,
    }

    let cid

    if(confirmed){
      let content = JSON.stringify(requestData);
      cid = await NodeUtils.createCID(newRequest)
      fs.writeFileSync(`${__dirname}/../data/${cid.toString()}.req`, content)
    }

    res.json({
      success: confirmed,
      cid,
      ...requestData
    })
  } catch (e) {
    console.log(e)
    res.json({
      success: false,
      error: e
    })
  }
}

module.exports.getPeerInfo = async (req, res, next) => {
  let {peerId} = req.params || {}

  if(!peerId){
    return res.json({
      success: false,
      message: 'Unknown peerId'
    })
  }

  NodeCaller.call('peer_info', {peerId: 'QmcrQZ6RJdpYuGvZqD5QEHAv6qX4BrQLJLQPQUrTrzdcgm'})
    .then(result => {
      res.json({
        success: true,
        result
      })
    })

}

module.exports.getRequestContent = (req, res, next) => {
  let {cid} = req.params;

  NodeCaller.call('request_data', {cid})
    .then(result => {
      res.json({
        success: true,
        ...result
      })
    })
    .catch(error => {
      res.json(error)
    })
}
