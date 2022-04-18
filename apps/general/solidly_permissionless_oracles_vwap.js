const { axios, toBaseUnit, soliditySha3, BN, multiCall } = MuonAppUtils

const getTimestamp = () => Math.floor(Date.now() / 1000)
const TOKEN_META_DATA = 'tokenMetaData'
const TOTAL_SUPPLY = 'totalSupply'
const PAIRS0_META_DATA = 'pairs0MetaData'
const PAIRS1_META_DATA = 'pairs1MetaData'
const PAIRS_META_DATA = 'pairsMetaData'

const BASE_PAIR_METADATA = [
  {
    inputs: [],
    name: 'metadata',
    outputs: [
      { internalType: 'uint256', name: 'dec0', type: 'uint256' },
      { internalType: 'uint256', name: 'dec1', type: 'uint256' },
      { internalType: 'uint256', name: 'r0', type: 'uint256' },
      { internalType: 'uint256', name: 'r1', type: 'uint256' },
      { internalType: 'bool', name: 'st', type: 'bool' },
      { internalType: '', name: 't0', type: 'address' },
      { internalType: 'address', name: 't1', type: 'address' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]

const ERC20_ABI = [
  {
    constant: true,
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  }
]

const PRICE_TOLERANCE = 0.05
const FANTOM_ID = 250
const SCALE = new BN('1000000000000000000')
const GRAPH_URL =
  'https://api.thegraph.com/subgraphs/name/shayanshiravani/solidly'
const GRAPH_DEPLOYMENT_ID = 'QmY4uUc7kjAC2sCbviZGoTwttbJ6dXezWELyrn9oebAr58'

async function getTokenTxs(pairAddr, graphUrl, deploymentID) {
  let currentTimestamp = getTimestamp()
  const last30Min = currentTimestamp - 1800
  let skip = 0
  let tokenTxs = []
  while (true) {
    const query = `
      {
        swaps(
          first: 1000,
          skip: ${skip},
          where: {
            pair: "${pairAddr.toLowerCase()}"
            timestamp_gt: ${last30Min}
            timestamp_lt: ${currentTimestamp}
          },
          orderBy: timestamp,
          orderDirection: desc
        ) {
          amount0In
          amount1In
          amount0Out
          amount1Out
          timestamp
        }
        _meta {
          deployment
        }
      }
    `
    skip += 1000
    let response = await axios.post(graphUrl, {
      query: query
    })
    let data = response?.data
    if (response?.status == 200 && data.data?.hasOwnProperty('swaps')) {
      if (data.data._meta.deployment != deploymentID) {
        throw { message: 'SUBGRAPH_IS_UPDATED' }
      }
      const swaps = data.data.swaps
      if(!swaps.length)
      {
        break
      }
      tokenTxs = tokenTxs.concat(swaps)
      if(skip > 5000)
      {
        currentTimestamp = swaps[swaps.length-1]['timestamp']
        skip = 0
      }
    }else
    {
      throw { message: 'INVALID_SUBGRAPH_RESPONSE' }
    }
  }
  return tokenTxs
}

function makeCallContext(info, prefix) {
  const contractCallContext = info.map((item) => ({
    reference: prefix + ':' + item,
    contractAddress: item,
    abi: BASE_PAIR_METADATA,
    calls: [
      {
        reference: prefix + ':' + item,
        methodName: 'metadata'
      }
    ]
  }))

  return contractCallContext
}

function getInfoContract(multiCallInfo, filterBy) {
  return multiCallInfo.filter((item) => item.reference.startsWith(filterBy))
}

function getMetadata(multiCallInfo, filterBy) {
  const info = getInfoContract(multiCallInfo, filterBy)
  let metadata = info.map((item) => {
    return {
      dec0: item.callsReturnContext[0].returnValues[0],
      dec1: item.callsReturnContext[0].returnValues[1],
      r0: item.callsReturnContext[0].returnValues[2],
      r1: item.callsReturnContext[0].returnValues[3],
      st: item.callsReturnContext[0].returnValues[4],
      t0: item.callsReturnContext[0].returnValues[5],
      t1: item.callsReturnContext[0].returnValues[6]
    }
  })
  return metadata
}

async function tokenVWAP(token, pairs, metadata) {
  let pairPrices = []
  let pairVolume = []
  let inputToken = token
  if (!metadata) {
    const contractCallContext = makeCallContext(pairs, PAIRS_META_DATA)
    let result = await multiCall(FANTOM_ID, contractCallContext)
    metadata = getMetadata(result, PAIRS_META_DATA)
  }
  let pairVWAPPromises = []
  for (let i = 0; i < pairs.length; i++) {
    let index = inputToken.toLowerCase() == metadata[i].t0.toLowerCase() ? 0 : 1

    if (inputToken.toLowerCase() == metadata[i].t0.toLowerCase()) {
      inputToken = metadata[i].t1
    } else if (inputToken.toLowerCase() == metadata[i].t1.toLowerCase()) {
      inputToken = metadata[i].t0
    } else {
      throw { message: 'INVALID_PAIRS' }
    }
    pairVWAPPromises.push(pairVWAP(pairs[i], index))
  }
  let pairVWAPs = await Promise.all(pairVWAPPromises)
  pairVWAPs.map(pairVWAP => {
    pairPrices.push(pairVWAP.tokenPrice)
    pairVolume.push(pairVWAP.sumVolume)
  })
  let price = new BN(SCALE)
  let volume = pairVolume.reduce(function (previousValue, currentValue) {
    return previousValue.add(currentValue)
  })
  pairPrices.map((x) => {
    price = price.mul(x).div(SCALE)
  })
  return { price, volume }
}

async function pairVWAP(pair, index) {
  return getTokenTxs(
    pair,
    GRAPH_URL,
    GRAPH_DEPLOYMENT_ID
    ).then(tokenTxs => {
    let sumWeightedPrice = new BN('0')
    let sumVolume = new BN('0')
    for (let i = 0; i < tokenTxs.length; i++) {
      let swap = tokenTxs[i]
      let price = new BN('0')
      let volume = new BN('0')
      switch (index) {
        case 0:
          if (swap.amount0In != 0) {
            let amount0In = toBaseUnit(swap.amount0In, '18')
            let amount1Out = toBaseUnit(swap.amount1Out, '18')
            price = amount1Out.mul(SCALE).div(amount0In)
            volume = amount0In
          } else {
            let amount1In = toBaseUnit(swap.amount1In, '18')
            let amount0Out = toBaseUnit(swap.amount0Out, '18')
            price = amount1In.mul(SCALE).div(amount0Out)
            volume = amount0Out
          }
          break
        case 1:
          if (swap.amount0In != 0) {
            let amount0In = toBaseUnit(swap.amount0In, '18')
            let amount1Out = toBaseUnit(swap.amount1Out, '18')
            price = amount0In.mul(SCALE).div(amount1Out)
            volume = amount1Out
          } else {
            let amount1In = toBaseUnit(swap.amount1In, '18')
            let amount0Out = toBaseUnit(swap.amount0Out, '18')
            price = amount0Out.mul(SCALE).div(amount1In)
            volume = amount1In
          }
          break
        default:
          break
      }
      sumWeightedPrice = sumWeightedPrice.add(price.mul(volume))
      sumVolume = sumVolume.add(volume)
    }
    if (sumVolume > new BN('0')) {
      let tokenPrice = sumWeightedPrice.div(sumVolume)
      return { tokenPrice, sumVolume }
    }
    return { tokenPrice: new BN('0'), sumVolume: new BN('0') }
  })
}

async function LPTokenPrice(token, pairs0, pairs1) {
  const contractCallContextToken = makeCallContext([token], TOKEN_META_DATA)
  const contractCallContextSupply = [
    {
      reference: TOTAL_SUPPLY,
      contractAddress: token,
      abi: ERC20_ABI,
      calls: [
        {
          reference: TOTAL_SUPPLY,
          methodName: 'totalSupply'
        }
      ]
    }
  ]
  const contractCallContextPairs0 = makeCallContext(pairs0, PAIRS0_META_DATA)

  const contractCallContextPairs1 = makeCallContext(pairs1, PAIRS1_META_DATA)
  const contractCallContext = [
    ...contractCallContextToken,
    ...contractCallContextSupply,
    ...contractCallContextPairs0,
    ...contractCallContextPairs1
  ]

  return multiCall(FANTOM_ID, contractCallContext).then(async result => {
    let metadata = getMetadata(result, TOKEN_META_DATA)[0]

    let totalSupply = result.find((item) => item.reference === TOTAL_SUPPLY)
    totalSupply = new BN(totalSupply.callsReturnContext[0].returnValues[0])

    let reserveA = new BN(metadata.r0).mul(SCALE).div(new BN(metadata.dec0))

    let reserveB = new BN(metadata.r1).mul(SCALE).div(new BN(metadata.dec1))

    let totalUSDA = reserveA
    let sumVolume = new BN('0')

    let _tokenVWAPResults = await Promise.all([
      pairs0.length ? tokenVWAP(
        metadata.t0,
        pairs0,
        getMetadata(result, PAIRS0_META_DATA)
      ) : null
      ,pairs1.length ? tokenVWAP(
        metadata.t1,
        pairs1,
        getMetadata(result, PAIRS1_META_DATA)
      ) : null
    ])
    if (pairs0.length) {
      const { price, volume } = _tokenVWAPResults[0]
      totalUSDA = price.mul(reserveA).div(SCALE)
      sumVolume = volume
    }

    let totalUSDB = reserveB
    if (pairs1.length) {
      const { price, volume } = _tokenVWAPResults[1]
      totalUSDB = price.mul(reserveB).div(SCALE)
      sumVolume = volume
    }

    let totalUSD = totalUSDA.add(totalUSDB)

    return { price: totalUSD.mul(SCALE).div(totalSupply).toString(), sumVolume }
  })
}

module.exports = {
  APP_NAME: 'solidly_permissionless_oracles_vwap',
  APP_ID: 16,

  onRequest: async function (request) {
    let {
      method,
      nSign,
      data: { params }
    } = request

    switch (method) {
      case 'price':
        let { token, pairs, hashTimestamp } = params
        if (typeof pairs === 'string' || pairs instanceof String) {
          pairs = pairs.split(',')
        }
        let { price, volume } = await tokenVWAP(token, pairs)
        return {
          token: token,
          tokenPrice: price.toString(),
          pairs: pairs,
          volume: volume.toString(),
          ...(hashTimestamp ? { timestamp: request.data.timestamp } : {})
        }
      case 'lp_price': {
        let { token, pairs0, pairs1, hashTimestamp } = params
        if (typeof pairs0 === 'string' || pairs0 instanceof String) {
          pairs0 = pairs0.split(',').filter((x) => x)
        }
        if (typeof pairs1 === 'string' || pairs1 instanceof String) {
          pairs1 = pairs1.split(',').filter((x) => x)
        }

        let { price, sumVolume } = await LPTokenPrice(token, pairs0, pairs1)

        return {
          token: token,
          tokenPrice: price,
          pairs0: pairs0,
          pairs1: pairs1,
          volume: sumVolume.toString(),
          ...(hashTimestamp ? { timestamp: request.data.timestamp } : {})
        }
      }

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  isPriceToleranceOk: function (price, expectedPrice) {
    let priceDiff = Math.abs(price - expectedPrice)
    if (priceDiff / expectedPrice > PRICE_TOLERANCE) {
      return false
    }
    return true
  },

  hashRequestResult: function (request, result) {
    let {
      method,
      data: { params }
    } = request
    let { hashTimestamp } = params
    switch (method) {
      case 'price': {
        if (
          !this.isPriceToleranceOk(
            result.tokenPrice,
            request.data.result.tokenPrice
          )
        ) {
          throw { message: 'Price threshold exceeded' }
        }
        let { token, pairs } = result

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: token },
          { type: 'address[]', value: pairs },
          { type: 'uint256', value: request.data.result.tokenPrice },
          { type: 'uint256', value: request.data.result.volume },
          ...(hashTimestamp
            ? [{ type: 'uint256', value: request.data.timestamp }]
            : [])
        ])
      }
      case 'lp_price': {
        if (
          !this.isPriceToleranceOk(
            result.tokenPrice,
            request.data.result.tokenPrice
          )
        ) {
          throw { message: 'Price threshold exceeded' }
        }
        let { token, pairs0, pairs1 } = result
        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: token },
          { type: 'address[]', value: pairs0 },
          { type: 'address[]', value: pairs1 },
          { type: 'uint256', value: request.data.result.tokenPrice },
          { type: 'uint256', value: request.data.result.volume },

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
