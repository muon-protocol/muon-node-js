const PriceCache = require('./price-cache')
const WebSocket = require('ws')
const API_KEY = process.env.FINNHUB_API_KEY
const SYMBOLS = 'TSLA'; //process.env.FINNHUB_SUBSCRIBE_SYMBOLS || 'TSLA'
const VERBOSE = false;

let waitBeforeReconnect = 1000;

function onTradeData(data){
  if(VERBOSE)
    console.log("finnhub websocket: ", data)
  for(let trade of data){
    let price = {
        "symbol": trade['s'].toUpperCase(),
        "price": trade['p'],
        "timestamp": Math.floor(trade['t'] / 1000)
      }
      PriceCache.setSymbolPrice(trade['s'], price)
  }
}

function connect(){
  const ws = new WebSocket(`wss://ws.finnhub.io?token=${API_KEY}`)

  ws.on('open', function open() {
    waitBeforeReconnect = 1000;
    if(VERBOSE)
      console.log("============== finnhub trade socket subscription start ==============")
    let symbolsToSubscribe = SYMBOLS.split(';')
    for(let symbol of symbolsToSubscribe) {
      // console.log(`>>>>>>>>>> subscribing to symbol: ${symbol}`)
      ws.send(`{"type":"subscribe","symbol":"${symbol}"}`)
    }
  });


  ws.on('close', function onClose() {
    if(VERBOSE)
      console.log(`finnhub websocket disconnected. reconnect after ${waitBeforeReconnect} ms`);
    setTimeout(function() {
      waitBeforeReconnect = Math.min(waitBeforeReconnect * 2, 60000)
      connect();
    }, waitBeforeReconnect);
  });

  ws.on('message', function onMessage(msgStr) {
    try{
      let msg = JSON.parse(msgStr)
      switch (msg.type) {
        case 'trade':
          onTradeData(msg.data);
          break;
        default:
          if(VERBOSE)
            console.log('finnhub websocket: ', msgStr)
          break
      }
    }
    catch (e) {
      if(VERBOSE)
        console.log('[ERROR] finnhub websocket : ', msgStr)
    }
  });

  ws.on('error', function onError(e) {
    // console.log('finnhub websocket error', e.message)
    ws.close()
  });
}

connect()

