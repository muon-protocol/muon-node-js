let client = null;

function setRedisClient(redisClient) {
  client = redisClient;
}

function setSymbolPrice(symbol, info){
  if(!client)
    return Promise.reject({message: "redis client not initialized."})
  return client.set(symbol.toUpperCase(), JSON.stringify(info))
}

function getSymbolPrice(symbol){
  return client.get(symbol.toUpperCase()).then(reply => {
      let info = JSON.parse(reply)
      return info
  })
}
module.exports = {
  setRedisClient,
  setSymbolPrice,
  getSymbolPrice,
}




