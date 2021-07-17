const BaseService = require('./base/base-service-plugin')
const crypto = require('../utils/crypto')
const Sources = require('../gateway/sources')


class StockPlugin extends BaseService {
  APP_NAME = 'stock';

  async onRequest(request){
    let {method, data: {params}} = request;
    switch (method) {
      case 'get_price': {
        let {symbol, source = "finnhub", timestamp=null} = params || {}
        if (!symbol) {
          throw {message: "Missing symbol param"}
        }
        let price = await Sources.getSymbolPrice(symbol, source, timestamp)
        if (!price) {
          throw {"message": "Price not found"}
        }

        let result = {
          symbol: symbol,
          price: price['price'],
          timestamp: price['timestamp'],
          source: source,
          // rawPrice: price,
        }
        return result;
      }
    }
  }

  isPriceToleranceOk(price, expectedPrice){
    let priceDiff = Math.abs(price - expectedPrice)
    if(priceDiff/expectedPrice > parseFloat(process.env.PRICE_TOLERANCE)){
      return false
    }
    return true;
  }

  hashRequestResult(request, result) {
    if(!this.isPriceToleranceOk(result['price'], request['data']['result']['price'])){
      throw {message: "Price threshold exceeded"}
    }
    return crypto.soliditySha3([
      { type: 'bytes32', value: `0x${request._id}` },
      { type: 'bytes32', value: `${request.data.result.timestamp}`},
      { type: 'bytes32', value: `${request.data.result.price}` },
    ]);
  }
}

module.exports = StockPlugin;
