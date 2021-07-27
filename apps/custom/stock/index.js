const {soliditySha3} = MuonAppUtils;
const Sources = require('./sources')

const PRICE_TOLERANCE = 0.05;

module.exports = {
  APP_NAME: 'stock',
  dependencies: ['redis'],

  onAppInit: async function(){
    console.log('initializing stock app ...');
    Sources.init(this.redis);
  },

  onRequest: async function(request){
    let {method, data: {params}} = request;
    switch (method) {
      case 'get_price': {
        let {symbol, source = "finnhub", timestamp=null} = params || {}
        if (!symbol) {
          throw {message: "Missing symbol param"}
        }
        symbol = symbol.toUpperCase();
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
  },

  isPriceToleranceOk: function(price, expectedPrice){
    let priceDiff = Math.abs(price - expectedPrice)
    if(priceDiff/expectedPrice > PRICE_TOLERANCE){
      return false
    }
    return true;
  },

  hashRequestResult: function(request, result) {
    if(!this.isPriceToleranceOk(result['price'], request['data']['result']['price'])){
      throw {message: "Price threshold exceeded"}
    }
    return soliditySha3([
      { type: 'bytes32', value: `0x${request._id}` },
      { type: 'bytes32', value: `${request.data.result.timestamp}`},
      { type: 'bytes32', value: `${request.data.result.price}` },
    ]);
  }
}
