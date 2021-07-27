const finnhub = require('./finnhub')

const Sources = {
  finnhub,
}

module.exports.getSymbolPrice = (symbol, source, timestamp=null) => {
  if(!Sources[source])
    return Promise.reject({message: `Invalid source [${source}]`})

  return Sources[source].getSymbolPrice(symbol, timestamp)
}

module.exports.init = redisClient => {
  for(const src in Sources){
    if(Sources[src].init)
      Sources[src].init(redisClient);
  }
}
