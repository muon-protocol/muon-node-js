const BaseApp = require('./base/base-app-plugin')
const Request = require('../gateway/models/Request')
const Signature = require('../gateway/models/Signature')
const NodeUtils = require('../utils/node-utils')
const Sources = require('../gateway/sources')
const {omit} = require('lodash')
const {remoteApp, remoteMethod, gatewayMethod} = require('./base/app-decorators')

@remoteApp
class StockPlugin extends BaseApp {
  APP_BROADCAST_CHANNEL = 'muon/stock/request/broadcast'
  APP_NAME = 'stock'

  constructor(...args) {
    super(...args);
  }

  @gatewayMethod('get_price')
  async onGetPrice(data){
    let {symbol, source = "finnhub"} = data || {}
    if (!symbol) {
      throw {message: "Missing symbol param"}
    }
    let price = await Sources.getSymbolPrice(symbol, source)
    if (!price) {
      throw {"message": "Price not found"}
    }

    let startedAt = Date.now();
    let newRequest = new Request({
      app: 'stock',
      method: 'get_price',
      owner: process.env.SIGN_WALLET_ADDRESS,
      peerId: process.env.PEER_ID,
      data: {
        symbol: symbol,
        price: price['price'],
        timestamp: price['timestamp'],
        source: source,
        rawPrice: price,
      },
      startedAt,
    })
    await newRequest.save()
    let sign = NodeUtils.stock.signRequest(newRequest);
    (new Signature(sign)).save()

    this.broadcastNewRequest({
      type: 'new_request',
      peerId:  process.env.PEER_ID,
      _id: newRequest._id
    })

    let [confirmed, signatures] = await this.isOtherNodesConfirmed(newRequest, parseInt(process.env.NUM_SIGN_TO_CONFIRM))

    let requestData = {
      confirmed,
      ...omit(newRequest._doc, ['__v', 'data.source', 'data.rawPrice']),
      signatures,
    }

    if (confirmed) {
      newRequest['confirmedAt'] = Date.now()
      newRequest.save()
      await this.emit('request-signed', requestData)
    }

    return {
      cid: await NodeUtils.stock.createCID(requestData),
      ...requestData
    }
  }

  recoverSignature(sig) {
    return NodeUtils.stock.recoverSignature(sig)
  }

  async processRemoteRequest(request) {
    let sign = NodeUtils.stock.signRequest(request)
    return sign
  }
}

module.exports = StockPlugin;
