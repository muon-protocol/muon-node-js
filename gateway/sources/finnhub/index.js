const Api = require('./api');
require('./websocket')
const PriceCache = require('./price-cache')

async function getSymbolPrice(symbol) {
  let result = await PriceCache.getSymbolPrice(symbol)
  if(!result){
    // console.log('Price not exist in redis')
    result = await Api.getStockPrice(symbol)
    // console.log('price from api', result)
  }
  return result
}

module.exports = {
  getSymbolPrice,
}
