const { axios, toBaseUnit, soliditySha3, BN, multiCall } = MuonAppUtils

const getTimestamp = () => Math.floor(Date.now() / 1000)
const TOKEN_META_DATA = 'tokenMetaData'
const TOTAL_SUPPLY = 'totalSupply'
const PAIRS0_META_DATA = 'pairs0MetaData'
const PAIRS1_META_DATA = 'pairs1MetaData'

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

async function getTokenTxs(pairAddr) {
  try {
    const currentTimestamp = getTimestamp()
    const last30Min = currentTimestamp - 1800
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
    })
    let data = response?.data
    if (response?.status == 200 && data.data?.swaps.length > 0) {
      return data.data.swaps
    }
  } catch (error) {
    console.log(error)
  }
  return false
}

async function tokenVWAP(token, pairs, metadata) {
  var pairPrices = []
  var inputToken = token
  if (!metadata) {
    const contractCallContext = pairs.map((pair) => ({
      reference: pair,
      contractAddress: pair,
      abi: BASE_PAIR_METADATA,
      calls: [
        {
          reference: pair,
          methodName: 'metadata'
        }
      ]
    }))
    let result = await multiCall(FANTOM_ID, contractCallContext)
    metadata = result.map((item) => ({
      dec0: item.callsReturnContext[0].returnValues[0],
      dec1: item.callsReturnContext[0].returnValues[1],
      r0: item.callsReturnContext[0].returnValues[2],
      r1: item.callsReturnContext[0].returnValues[3],
      st: item.callsReturnContext[0].returnValues[4],
      t0: item.callsReturnContext[0].returnValues[5],
      t1: item.callsReturnContext[0].returnValues[6]
    }))
  }

  for (var i = 0; i < pairs.length; i++) {
    var index = inputToken.toLowerCase() == metadata[i].t0.toLowerCase() ? 0 : 1

    if (inputToken.toLowerCase() == metadata[i].t0.toLowerCase()) {
      inputToken = metadata[i].t1
    } else if (inputToken.toLowerCase() == metadata[i].t1.toLowerCase()) {
      inputToken = metadata[i].t0
    } else {
      throw 'INVALID_PAIRS'
    }
    pairPrices.push(await pairVWAP(pairs[i], index))
  }
  var price = new BN(SCALE)
  pairPrices.map((x) => {
    price = price.mul(x).div(SCALE)
  })
  return price
}

async function pairVWAP(pair, index) {
  let tokenTxs = await getTokenTxs(pair)
  if (tokenTxs) {
    let sumWeightedPrice = new BN('0')
    let sumVolume = new BN('0')
    for (var i = 0; i < tokenTxs.length; i++) {
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
      return tokenPrice
    }
  }
  return new BN('0')
}

async function LPTokenPrice(token, pairs0, pairs1) {
  const contractCallContextToken = [
    {
      reference: TOKEN_META_DATA + ':' + token,
      contractAddress: token,
      abi: BASE_PAIR_METADATA,
      calls: [
        {
          reference: TOKEN_META_DATA + ':' + token,
          methodName: 'metadata'
        }
      ]
    },
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
  const contractCallContextPairs0 = pairs0.map((pair) => ({
    reference: PAIRS0_META_DATA + ':' + pair,
    contractAddress: pair,
    abi: BASE_PAIR_METADATA,
    calls: [
      {
        reference: PAIRS0_META_DATA + ':' + pair,
        methodName: 'metadata'
      }
    ]
  }))

  const contractCallContextPairs1 = pairs1.map((pair) => {
    return {
      reference: PAIRS1_META_DATA + ':' + pair,
      contractAddress: pair,
      abi: BASE_PAIR_METADATA,
      calls: [
        {
          reference: PAIRS1_META_DATA + ':' + pair,
          methodName: 'metadata'
        }
      ]
    }
  })

  const contractCallContext = [
    ...contractCallContextToken,
    ...contractCallContextPairs0,
    ...contractCallContextPairs1
  ]

  let result = await multiCall(FANTOM_ID, contractCallContext)

  const tokenMetaData = result.find((item) =>
    item.reference.startsWith(TOKEN_META_DATA)
  )
  let metadata = {
    dec0: tokenMetaData.callsReturnContext[0].returnValues[0],
    dec1: tokenMetaData.callsReturnContext[0].returnValues[1],
    r0: tokenMetaData.callsReturnContext[0].returnValues[2],
    r1: tokenMetaData.callsReturnContext[0].returnValues[3],
    st: tokenMetaData.callsReturnContext[0].returnValues[4],
    t0: tokenMetaData.callsReturnContext[0].returnValues[5],
    t1: tokenMetaData.callsReturnContext[0].returnValues[6]
  }
  let totalSupply = result.find((item) => item.reference === TOTAL_SUPPLY)
  totalSupply = new BN(totalSupply.callsReturnContext[0].returnValues[0])

  let reserveA = new BN(metadata.r0).mul(SCALE).div(new BN(metadata.dec0))

  let reserveB = new BN(metadata.r1).mul(SCALE).div(new BN(metadata.dec1))

  let totalUSDA = reserveA
  if (pairs0.length) {
    let resultPairs0 = result.filter((item) =>
      item.reference.startsWith(PAIRS0_META_DATA)
    )
    let pairs0Metadata = resultPairs0.map((item) => ({
      dec0: item.callsReturnContext[0].returnValues[0],
      dec1: item.callsReturnContext[0].returnValues[1],
      r0: item.callsReturnContext[0].returnValues[2],
      r1: item.callsReturnContext[0].returnValues[3],
      st: item.callsReturnContext[0].returnValues[4],
      t0: item.callsReturnContext[0].returnValues[5],
      t1: item.callsReturnContext[0].returnValues[6]
    }))
    totalUSDA = (await tokenVWAP(metadata.t0, pairs0, pairs0Metadata))..mul(
      new BN(metadata.r0)
    )
  }

  let totalUSDB = reserveB
  if (pairs1.length) {
    let resultPairs1 = result.filter((item) =>
      item.reference.startsWith(PAIRS1_META_DATA)
    )
    let pairs1Metadata = resultPairs1.map((item) => ({
      dec0: item.callsReturnContext[0].returnValues[0],
      dec1: item.callsReturnContext[0].returnValues[1],
      r0: item.callsReturnContext[0].returnValues[2],
      r1: item.callsReturnContext[0].returnValues[3],
      st: item.callsReturnContext[0].returnValues[4],
      t0: item.callsReturnContext[0].returnValues[5],
      t1: item.callsReturnContext[0].returnValues[6]
    }))
    totalUSDB = (await tokenVWAP(metadata.t1, pairs1, pairs1Metadata)).mul(
      new BN(metadata.r1)
    )
  }

  let totalUSD = totalUSDA.add(totalUSDB)

  return totalUSD.mul(SCALE).div(totalSupply).toString()
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
        let tokenPrice = await tokenVWAP(token, pairs)
        return {
          token: token,
          tokenPrice: tokenPrice.toString(),
          pairs: pairs,
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

        let tokenPrice = await LPTokenPrice(token, pairs0, pairs1)

        return {
          token: token,
          tokenPrice: tokenPrice,
          pairs0: pairs0,
          pairs1: pairs1,
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
        let { token, tokenPrice, pairs0, pairs1 } = result

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: token },
          { type: 'address[]', value: pairs0 },
          { type: 'address[]', value: pairs1 },
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
