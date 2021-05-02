const redis = require('redis');
const client = redis.createClient({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379
});

client.on("error", function(error) {
  console.error(error);
});

function setSymbolPrice(symbol, info){
  return new Promise(function (resolve, reject) {
    client.set(`muon-symbol-price-${symbol.toUpperCase()}`, JSON.stringify(info), (err, res) => {
      if(err) {
        reject(err)
      }
      else
        resolve(res)
    })
  })
}

function getSymbolPrice(symbol){
  return new Promise(function (resolve, reject) {
    client.get(`muon-symbol-price-${symbol.toUpperCase()}`, function (err, reply) {
      if(err) {
        // reject(err)
        resolve(null)
      }
      else{
        try{
          let info = JSON.parse(reply)
          resolve(info)
        }
        catch (e) {
          reject(e)
        }
      }
    })
  })
}
module.exports = {
  setSymbolPrice,
  getSymbolPrice,
}




