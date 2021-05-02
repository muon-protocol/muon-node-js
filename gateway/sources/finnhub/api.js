const axios = require('axios');

const API_KEY = process.env.FINNHUB_API_KEY

function getStockCandle(symbol, ts1, ts2){
  return axios.get(`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=1&from=${ts1}&to=${ts2}&token=${API_KEY}`)
    .then(({data}) => data)
}

function getQuote(symbol){
  return axios.get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEY}`)
    .then(({data}) => data)
}

function getStockPrice(symbol, timestamp){
  if(!timestamp){
    return getQuote(symbol)
      .then(result => {
        if('c' in result && result['c'] > 0){
          return {
            symbol,
            price: result['c'],
            timestamp: result['t']
          }
        }
        else{
          return null
        }
      })
  }
  else{
    return getStockCandle(symbol, timestamp-1200, timestamp)
      .then(result => {
        if('s' in result && result['s'] === 'ok' && result['l']){
          let n = result['l'].length - 1
          return {
            symbol,
            price: result['c'][n],
            timestamp: result['t'][n],
          }
        }
        else{
          return null
        }
      })
  }
}

module.exports = {
  getStockPrice,
}
