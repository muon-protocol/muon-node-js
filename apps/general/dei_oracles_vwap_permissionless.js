const { axios, toBaseUnit, soliditySha3, BN, recoverTypedMessage, ethCall } =
  MuonAppUtils

const getTimestamp = () => Math.floor(Date.now() / 1000);
const BASE_PAIR_METADATA = [{       "inputs":[            ],       "name":"metadata",       "outputs":[          {             "internalType":"uint256",             "name":"dec0",             "type":"uint256"          },          {             "internalType":"uint256",             "name":"dec1",             "type":"uint256"          },          {             "internalType":"uint256",             "name":"r0",             "type":"uint256"          },          {             "internalType":"uint256",             "name":"r1",             "type":"uint256"          },          {             "internalType":"bool",             "name":"st",             "type":"bool"          },          {             "internalType":"",             "name":"t0",             "type":"address"          },          {             "internalType":"address",             "name":"t1",             "type":"address"          }       ],       "stateMutability":"view",       "type":"function"    }] ;
//TODO: we need just totalSupply ABI
const ERC20_ABI = [{"inputs":[],"payable":false,"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"sender","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount0","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount1","type":"uint256"},{"indexed":true,"internalType":"address","name":"to","type":"address"}],"name":"Burn","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"sender","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount0","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount1","type":"uint256"}],"name":"Mint","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"sender","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount0In","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount1In","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount0Out","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount1Out","type":"uint256"},{"indexed":true,"internalType":"address","name":"to","type":"address"}],"name":"Swap","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint112","name":"reserve0","type":"uint112"},{"indexed":false,"internalType":"uint112","name":"reserve1","type":"uint112"}],"name":"Sync","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"constant":true,"inputs":[],"name":"DOMAIN_SEPARATOR","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"MINIMUM_LIQUIDITY","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"PERMIT_TYPEHASH","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"to","type":"address"}],"name":"burn","outputs":[{"internalType":"uint256","name":"amount0","type":"uint256"},{"internalType":"uint256","name":"amount1","type":"uint256"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"factory","outputs":[{"internalType":"address","name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"getReserves","outputs":[{"internalType":"uint112","name":"_reserve0","type":"uint112"},{"internalType":"uint112","name":"_reserve1","type":"uint112"},{"internalType":"uint32","name":"_blockTimestampLast","type":"uint32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"_token0","type":"address"},{"internalType":"address","name":"_token1","type":"address"}],"name":"initialize","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"kLast","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"to","type":"address"}],"name":"mint","outputs":[{"internalType":"uint256","name":"liquidity","type":"uint256"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"nonces","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"uint8","name":"v","type":"uint8"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"permit","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"price0CumulativeLast","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"price1CumulativeLast","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"to","type":"address"}],"name":"skim","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"uint256","name":"amount0Out","type":"uint256"},{"internalType":"uint256","name":"amount1Out","type":"uint256"},{"internalType":"address","name":"to","type":"address"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"swap","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[],"name":"sync","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"token0","outputs":[{"internalType":"address","name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"token1","outputs":[{"internalType":"address","name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"}]

const PRICE_TOLERANCE = 0.05;
const FANTOM_ID = 250;
const SCALE = new BN('1000000000000000000');
const GRAPH_URL = "https://api.thegraph.com/subgraphs/name/shayanshiravani/solidly";

async function getTokenTxs(pairAddr){
  try {
    const currentTimestamp = getTimestamp();
    const last30Min = currentTimestamp - 1800;
    const query = `
      {
        swaps(
          where: {
            pair: "${pairAddr.toLowerCase()}"
            timestamp_gt: ${last30Min}
          }, 
          orderBy: timestamp, 
          orderDirection: desc
        ) {
          amount0In
          amount1In
          amount0Out
          amount1Out
        }
      }
    `

    let response = await axios.post(GRAPH_URL, {
      query: query 
    });
    let data = response?.data;
    if(
      response?.status == 200 &&
      data.data?.swaps.length > 0
      )
    {
      return data.data.swaps;
    }
  } catch (error) {
    console.log(error);
  }
  return false;
}

async function tokenVWAP(token, pairs){
  var pairPrices = [];
  var inputToken = token;
  for(var i=0; i<pairs.length;i++){
    //TODO: use multicall
    var metadata = await ethCall(
      pairs[i],
      'metadata',
      [],
      BASE_PAIR_METADATA,
      FANTOM_ID
    );
    var index = inputToken.toLowerCase() == metadata.t0.toLowerCase() ? 0 : 1;

    if(inputToken.toLowerCase() == metadata.t0.toLowerCase()){
      inputToken = metadata.t1;
    }else if(inputToken.toLowerCase() == metadata.t1.toLowerCase()){
      inputToken = metadata.t0;
    }else{
      throw "INVALID_PAIRS";
    }
    pairPrices.push(
      await pairVWAP(pairs[i], index)
    );
  }
  var price = new BN(SCALE);
  pairPrices.map(x => {
    price = price.mul(x).div(SCALE)
  });
  return price;
}

async function pairVWAP(pair, index){
  let tokenTxs = await getTokenTxs(pair);
  if(tokenTxs)
  {
    let sumWeightedPrice = new BN("0");
    let sumVolume = new BN("0");
    for(var i=0; i<tokenTxs.length; i++){
      let swap = tokenTxs[i];
      let price = new BN("0");
      let volume = new BN("0");
      switch (index) {
        case 0:
          if(swap.amount0In != 0)
          {
            let amount0In = toBaseUnit(swap.amount0In, "18");
            let amount1Out = toBaseUnit(swap.amount1Out, "18");
            price = amount1Out.mul(SCALE).div(amount0In);
            volume = amount0In;
          }else
          {
            let amount1In = toBaseUnit(swap.amount1In, "18");
            let amount0Out = toBaseUnit(swap.amount0Out, "18");
            price = amount1In.mul(SCALE).div(amount0Out);
            volume = amount0Out;
          }
          break;
        case 1:
          if(swap.amount0In != 0)
          {
            let amount0In = toBaseUnit(swap.amount0In, "18");
            let amount1Out = toBaseUnit(swap.amount1Out, "18");
            price = amount0In.mul(SCALE).div(amount1Out);
            volume = amount1Out;
          }else
          {
            let amount1In = toBaseUnit(swap.amount1In, "18");
            let amount0Out = toBaseUnit(swap.amount0Out, "18");
            price = amount0Out.mul(SCALE).div(amount1In);
            volume = amount1In;
          }
          break;
        default:
          break;
      }
      sumWeightedPrice = sumWeightedPrice.add(price.mul(volume));
      sumVolume = sumVolume.add(volume);
    }
    if(sumVolume > new BN("0"))
    {
      let tokenPrice = sumWeightedPrice.div(sumVolume);
      console.log("Pair", pair, "VWAP:", tokenPrice.toString());
      return tokenPrice;
    }
  }
  return new BN("0");
}

async function LPTokenPrice(token, pairs0, pairs1){
  //TODO: use multicall
  let metadata = await ethCall(
      token,
      'metadata',
      [],
      BASE_PAIR_METADATA,
      FANTOM_ID
  );
  let totalSupply = new BN(await ethCall(
    token,
    'totalSupply',
    [],
    ERC20_ABI,
    FANTOM_ID
  ));

  let reserveA = (new BN(metadata.r0)).mul(
    SCALE
  ).div(new BN(metadata.dec0));

  let reserveB = (new BN(metadata.r1)).mul(
    SCALE
  ).div(new BN(metadata.dec1));

  console.log("reserves", reserveA.toString(), reserveB.toString());

  let totalUSDA = reserveA;
  if(pairs0.length){
    totalUSDA = reserveA.mul(
      await tokenVWAP(metadata.t0, pairs0)
    ).div(SCALE);
  }

  let totalUSDB = reserveB;
  if(pairs1.length){
    totalUSDB = reserveB.mul(
      await tokenVWAP(metadata.t1, pairs1)
    ).div(SCALE);
  }  

  let totalUSD = totalUSDA.add(totalUSDB);

  return totalUSD.mul(SCALE).div(totalSupply).toString();
}

module.exports = {
  APP_NAME: 'dei_oracles_vwap_permissionless',
  APP_ID: 16,

  onRequest: async function (request) {
    let {
      method,
      nSign,
      data: { params }
    } = request

    switch (method) {
      case 'price':
        let {token, pairs, hashTimestamp} = params;
        if (typeof pairs === 'string' || pairs instanceof String){
          pairs = pairs.split(',');
        }
        let tokenPrice = await tokenVWAP(token, pairs);
        return {
          token: token,
          tokenPrice: tokenPrice.toString(),
          pairs: pairs,
          ...(hashTimestamp ? {timestamp: request.data.timestamp} : {})
        }
      case 'lp_price': {
        let {token, pairs0, pairs1, hashTimestamp} = params;
        if (typeof pairs0 === 'string' || pairs0 instanceof String){
          pairs0 = pairs0.split(',').filter(x => x);
        }
        if (typeof pairs1 === 'string' || pairs1 instanceof String){
          pairs1 = pairs1.split(',').filter(x => x);
        }
        
        let tokenPrice = await LPTokenPrice(token, pairs0, pairs1);

        return {
          token: token,
          tokenPrice: tokenPrice,
          pairs0: pairs0,
          pairs1: pairs1,
          ...(hashTimestamp ? {timestamp: request.data.timestamp} : {})
        }
      }
      
      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  isPriceToleranceOk: function(price, expectedPrice){
    let priceDiff = Math.abs(price - expectedPrice)
    if(priceDiff/expectedPrice > PRICE_TOLERANCE){
      return false
    }
    return true;
  },

  hashRequestResult: function (request, result) {
    let {
      method,
      data: { params }
    } = request;
    let { hashTimestamp } = params;
    switch (method) {
      case 'price':{
        if(!this.isPriceToleranceOk(result.tokenPrice, 
          request.data.result.tokenPrice)){
            throw {message: "Price threshold exceeded"}
        }
        let {token, pairs} = result;


        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: token },
          { type: 'address[]', value: pairs},
          { type: 'uint256', value: request.data.result.tokenPrice },
          ...(hashTimestamp
            ? [{ type: 'uint256', value: request.data.timestamp }]
            : [])
        ])
      }
      case 'lp_price': {
        if(!this.isPriceToleranceOk(result.tokenPrice, 
          request.data.result.tokenPrice)){
            throw {message: "Price threshold exceeded"}
        }
        let {token, tokenPrice, pairs0, pairs1} = result;


        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: token },
          { type: 'address[]', value: pairs0},
          { type: 'address[]', value: pairs1},
          { type: 'uint256', value: request.data.result.tokenPrice },
          ...(hashTimestamp
            ? [{ type: 'uint256', value: request.data.timestamp }]
            : [])
        ])
      }
      default:
        return null
    }
  }
}
