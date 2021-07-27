const Api = require('./api');
const wsService = require('./websocket')
const PriceCache = require('./price-cache')

function init(redisClient){
  PriceCache.setRedisClient(redisClient)
  wsService.start();
}

async function getSymbolPrice(symbol, timestamp) {
  let result = await PriceCache.getSymbolPrice(symbol)
  if(!result || !!timestamp){
    // console.log('Price not exist in redis')
    result = await Api.getStockPrice(symbol, timestamp)
    // console.log('price from api', result)
  }
  return result
}

module.exports = {
  init,
  getSymbolPrice,
}
