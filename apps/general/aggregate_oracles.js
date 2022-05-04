const { axios, toBaseUnit, soliditySha3, BN, multiCall, flatten, groupBy } =
  MuonAppUtils

const getTimestamp = () => Math.floor(Date.now() / 1000)

const PAIRS = 'pairs'
const TOKEN = 'token'
const TOTAL_SUPPLY = 'totalSupply'
const PRICE_TOLERANCE = '0.05'
const SCALE = new BN('1000000000000000000')

const Info_ABI = [
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint112', name: '_reserve0', type: 'uint112' },
      { internalType: 'uint112', name: '_reserve1', type: 'uint112' },
      { internalType: 'uint32', name: '_blockTimestampLast', type: 'uint32' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
]

const ERC20_TOTAL_SUPPLY_ABI = [
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

const ERC20_DECIMALS_ABI = [
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function'
  }
]

const GRAPH_DEPLOYMENT_ID = {
  solidly: 'QmY4uUc7kjAC2sCbviZGoTwttbJ6dXezWELyrn9oebAr58',
  spirit: 'QmUptbhTmAVCUTNeK2afecQJ3DFLgk9m4dBerfpqkTEJvi',
  uniswap: 'Qmc7K8dKoadu1VcHfAV45pN4sPnwZcU2okV6cuU4B7qQp1'
}
const GRAPH_URL = {
  solidly: 'https://api.thegraph.com/subgraphs/name/shayanshiravani/solidly',
  spirit: 'https://api.thegraph.com/subgraphs/name/shayanshiravani/spiritswap',
  uniswap: 'https://api.thegraph.com/subgraphs/name/ianlapham/uniswapv2'
}

async function getTokenTxs(pairAddr, graphUrl, deploymentID) {
  let currentTimestamp = getTimestamp()
  const last30Min = currentTimestamp - 1800
  let skip = 0
  let tokenTxs = []
  let queryIndex = 0
  while (true) {
    queryIndex += 1
    let lastRowQuery =
      queryIndex === 1
        ? `
        swaps_last_rows:swaps(
          first: 1,
          where: {
            pair: "${pairAddr.toLowerCase()}"
          },
          orderBy: timestamp,
          orderDirection: desc
        ) {
          transaction {
            id
      }
          amount0In
          amount1In
          amount0Out
          amount1Out
          timestamp
        }
      `
        : ''
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
            transaction {
              id
        }
            amount0In
            amount1In
            amount0Out
            amount1Out
            timestamp
          }
          ${lastRowQuery}
          _meta {
            deployment
          }
        }
      `
    skip += 1000
    try {
      const {
        data: { data },
        status
      } = await axios.post(graphUrl, {
        query: query
      })
      if (status == 200 && data) {
        const {
          swaps,
          _meta: { deployment }
        } = data
        if (deployment != deploymentID) {
          throw { message: 'SUBGRAPH_IS_UPDATED' }
        }
        if (!swaps.length) {
          if (queryIndex == 1) {
            tokenTxs = tokenTxs.concat(data.swaps_last_rows)
          }
          break
        }
        tokenTxs = tokenTxs.concat(swaps)
        if (skip > 5000) {
          currentTimestamp = swaps[swaps.length - 1]['timestamp']
          skip = 0
        }
      } else {
        throw { message: 'INVALID_SUBGRAPH_RESPONSE' }
      }
    } catch (error) {
      throw { message: 'SUBGRAPH_QUERY_FAILED' }
    }
  }
  return tokenTxs
}

function makeCallContextInfo(pairs, prefix) {
  let calls = []
  let pairCache = []

  pairs.forEach((pair, index) => {
    pair.forEach((item) => {
      if (!pairCache.includes(item.address)) {
        pairCache.push(item.address)
        calls.push({
          reference: prefix + '_' + item.exchange + ':' + item.address,
          contractAddress: item.address,
          abi: Info_ABI,
          calls: [
            {
              reference: prefix + ':' + item.address,
              methodName: 'getReserves'
            },
            {
              reference: prefix + ':' + item.address,
              methodName: 'token0'
            },
            {
              reference: prefix + ':' + item.address,
              methodName: 'token1'
            }
          ],
          context: {
            pairIndex: index,
            pair: item.address,
            exchange: item.exchange,
            chainId: item.chainId
          }
        })
      }
    })
  })
  return calls
}
function getMetadata(multiCallInfo, filterBy) {
  const info = getInfoContract(multiCallInfo, filterBy)
  let metadata = info.map((item) => {
    const reserves = getReturnValue(item.callsReturnContext, 'getReserves')

    return {
      reference: item.reference,
      pair: item.context.pair,
      pairIndex: item.context.pairIndex,
      exchange: item.context.exchange,
      chainId: item.context.chainId,
      r0: reserves[0],
      r1: reserves[1],

      t0: getReturnValue(item.callsReturnContext, 'token0')[0],
      t1: getReturnValue(item.callsReturnContext, 'token1')[0]
    }
  })
  return metadata
}

function getReturnValue(info, methodName) {
  return info.find((item) => item.methodName === methodName).returnValues
}

function getInfoContract(multiCallInfo, filterBy) {
  return multiCallInfo.filter((item) => item.reference.startsWith(filterBy))
}

function makeCallContextDecimal(metadata, prefix) {
  let callContext = metadata.map((item) => [
    {
      reference: prefix + ':' + 't0' + ':' + item.t0,
      contractAddress: item.t0,
      abi: ERC20_DECIMALS_ABI,
      calls: [
        {
          reference: 't0' + ':' + item.t0,
          methodName: 'decimals'
        }
      ],
      context: {
        exchange: item.exchange,
        chainId: item.chainId
      }
    },
    {
      reference: prefix + ':' + 't1' + ':' + item.t1,
      contractAddress: item.t1,
      abi: ERC20_DECIMALS_ABI,
      calls: [
        {
          reference: 't1' + ':' + item.t1,
          methodName: 'decimals'
        }
      ],
      context: {
        exchange: item.exchange,
        chainId: item.chainId
      }
    }
  ])

  callContext = [].concat.apply([], callContext)
  return callContext
}

function getFinalMetaData(resultDecimals, prevMetaData, prefix) {
  let metadata = prevMetaData.map((item) => {
    let t0 = getInfoContract(
      resultDecimals,
      prefix + ':' + 't0' + ':' + item.t0
    )
    let t1 = getInfoContract(
      resultDecimals,
      prefix + ':' + 't1' + ':' + item.t1
    )
    return {
      ...item,
      dec0: new BN(10)
        .pow(new BN(getReturnValue(t0[0].callsReturnContext, 'decimals')[0]))
        .toString(),
      dec1: new BN(10)
        .pow(new BN(getReturnValue(t1[0].callsReturnContext, 'decimals')[0]))
        .toString()
    }
  })
  return metadata
}

async function runMultiCall(contractCallContext) {
  let groupByChainId = groupBy(contractCallContext, 'context.chainId')

  let multiCallPromises = Object.keys(groupByChainId).map((chainId) =>
    multiCall(Number(chainId), groupByChainId[chainId])
  )
  let result = await Promise.all(multiCallPromises)
  return flatten(result)
}

function preparePromisePair(token, pairs, metadata) {
  return pairs.map((info) => {
    let inputToken = token
    return makePromisePair(inputToken, info, metadata)
  })
}
function makePromisePair(token, pairs, metadata) {
  let inputToken = token
  return pairs.map((pair) => {
    let currentMetadata = metadata.find(
      (item) =>
        item.reference === PAIRS + '_' + pair.exchange + ':' + pair.address
    )
    let index =
      inputToken.toLowerCase() == currentMetadata.t0.toLowerCase() ? 0 : 1
    if (inputToken.toLowerCase() == currentMetadata.t0.toLowerCase()) {
      inputToken = currentMetadata.t1
    } else if (inputToken.toLowerCase() == currentMetadata.t1.toLowerCase()) {
      inputToken = currentMetadata.t0
    } else {
      throw { message: 'INVALID_PAIRS' }
    }
    return pairVWAP(pair.address, index, pair.exchange)
  })
}
async function tokenVWAP(token, pairs, metadata) {
  let inputToken = token
  if (!metadata) {
    const contractCallContext = makeCallContextInfo(pairs, PAIRS)
    let result = await runMultiCall(contractCallContext)
    metadata = getMetadata(result, PAIRS)
    let callContextPairs = makeCallContextDecimal(metadata, PAIRS)
    let resultDecimals = await runMultiCall(callContextPairs)
    metadata = getFinalMetaData(resultDecimals, metadata, PAIRS)
  }
  let pairVWAPPromises = preparePromisePair(token, pairs, metadata)

  pairVWAPPromises = flatten(pairVWAPPromises)
  let pairVWAPs = await Promise.all(pairVWAPPromises)
  let sumVolume = new BN(0)
  let sumWeightedPrice = new BN('0')
  pairs.forEach((pair) => {
    let volume = pair.reduce((previousValue, currentValue) => {
      const result = pairVWAPs.find(
        (item) => item.pair === currentValue.address
      )
      return previousValue.add(result.sumVolume)
    }, new BN(0))
    let price = pair.reduce((price, currentValue) => {
      const result = pairVWAPs.find(
        (item) => item.pair === currentValue.address
      )
      return price.mul(result.tokenPrice).div(SCALE)
    }, new BN(SCALE))
    // TODO double check to be sure we need sum all exchange not avg
    sumVolume = sumVolume.add(volume)
    sumWeightedPrice = sumWeightedPrice.add(price.mul(volume))
  })
  // TODO this formula is correct
  let weightedAvg = sumWeightedPrice.div(sumVolume)
  if (sumVolume.toString() == '0' || weightedAvg.toString() == '0') {
    throw { message: 'INVALID_PRICE' }
  }

  return { price: weightedAvg, volume: sumVolume }
}

async function pairVWAP(pair, index, exchange) {
  const tokenTxs = await getTokenTxs(
    pair,
    GRAPH_URL[exchange],
    GRAPH_DEPLOYMENT_ID[exchange]
  )
  if (tokenTxs) {
    let sumWeightedPrice = new BN('0')
    let sumVolume = new BN('0')
    for (let i = 0; i < tokenTxs.length; i++) {
      let swap = tokenTxs[i]
      if (
        (swap.amount0In != 0 && swap.amount1In != 0) ||
        (swap.amount0Out != 0 && swap.amount1Out != 0) ||
        (swap.amount0In != 0 && swap.amount0Out != 0) ||
        (swap.amount1In != 0 && swap.amount1Out != 0)
      ) {
        continue
      }
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
      return { pair, tokenPrice, sumVolume }
    }
    return { pair, tokenPrice: new BN('0'), sumVolume: new BN('0') }
  }
}

async function LPTokenPrice(token, pairs0, pairs1, chainId) {
  const contractCallContextToken = [
    {
      reference: TOKEN + '_' + ':' + token,
      contractAddress: token,
      abi: Info_ABI,
      calls: [
        {
          reference: TOKEN + ':' + token,
          methodName: 'getReserves'
        },
        {
          reference: TOKEN + ':' + token,
          methodName: 'token0'
        },
        {
          reference: TOKEN + ':' + token,
          methodName: 'token1'
        }
      ],
      context: {
        chainId
      }
    }
  ]
  const contractCallContextSupply = [
    {
      reference: TOTAL_SUPPLY,
      contractAddress: token,
      abi: ERC20_TOTAL_SUPPLY_ABI,
      calls: [
        {
          reference: TOTAL_SUPPLY,
          methodName: 'totalSupply'
        }
      ],
      context: {
        chainId
      }
    }
  ]
  const contractCallContextPairs = makeCallContextInfo(
    [...pairs0, ...pairs1],
    PAIRS
  )
  const contractCallContext = [
    ...contractCallContextToken,
    ...contractCallContextSupply,
    ...contractCallContextPairs
  ]
  let result = await runMultiCall(contractCallContext)
  let metadata = getMetadata(result, TOKEN)
  let pairsMetadata = getMetadata(result, PAIRS)

  const callContextDecimalToken = makeCallContextDecimal(metadata, TOKEN)

  let callContextPairs = makeCallContextDecimal(pairsMetadata, PAIRS)

  const contractCallContextDecimal = [
    ...callContextDecimalToken,
    ...callContextPairs
  ]

  let resultDecimals = await runMultiCall(contractCallContextDecimal)

  metadata = getFinalMetaData(resultDecimals, metadata, TOKEN)[0]
  pairsMetadata = getFinalMetaData(resultDecimals, pairsMetadata, PAIRS)
  let totalSupply = getInfoContract(result, TOTAL_SUPPLY)[0].callsReturnContext
  totalSupply = new BN(totalSupply[0].returnValues[0])

  let reserveA = new BN(metadata.r0).mul(SCALE).div(new BN(metadata.dec0))

  let reserveB = new BN(metadata.r1).mul(SCALE).div(new BN(metadata.dec1))
  let totalUSDA = reserveA
  let sumVolume = new BN('0')
  let _tokenVWAPResults = await Promise.all([
    pairs0.length ? tokenVWAP(metadata.t0, pairs0, pairsMetadata) : null,
    pairs1.length ? tokenVWAP(metadata.t1, pairs1, pairsMetadata) : null
  ])

  if (pairs0.length) {
    const { price, volume } = _tokenVWAPResults[0]
    totalUSDA = price.mul(reserveA).div(SCALE)
    sumVolume = sumVolume.add(volume)
  }
  let totalUSDB = reserveB
  if (pairs1.length) {
    const { price, volume } = _tokenVWAPResults[1]
    totalUSDB = price.mul(reserveB).div(SCALE)
    sumVolume = sumVolume.add(volume)
  }

  let totalUSD = totalUSDA.add(totalUSDB)

  return {
    price: totalUSD.mul(SCALE).div(totalSupply).toString(),
    volume: sumVolume
  }
}

module.exports = {
  APP_NAME: 'aggregate_oracles',
  APP_ID: 24,

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request

    switch (method) {
      case 'price': {
        const { token, pairs, hashTimestamp } = params
        const { price, volume } = await tokenVWAP(token, pairs, null)
        // TODO :which will be send for pairs in sig array of address or obj

        return {
          token,
          tokenPrice: price.toString(),
          pairs,
          volume: volume.toString(),
          ...(hashTimestamp ? { timestamp: request.data.timestamp } : {})
        }
      }
      case 'lp_price': {
        const { token, pairs0, pairs1, chainId, hashTimestamp } = params
        const { price, volume } = await LPTokenPrice(
          token,
          pairs0,
          pairs1,
          chainId
        )

        // TODO :which will be send for pairs in sig array of address or obj
        return {
          token: token,
          tokenPrice: price,
          pairs0,
          pairs1,
          volume: volume.toString(),
          ...(hashTimestamp ? { timestamp: request.data.timestamp } : {})
        }
      }

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  isPriceToleranceOk: function (price, expectedPrice) {
    const priceDiff = new BN(price).sub(new BN(expectedPrice)).abs()

    if (
      new BN(priceDiff)
        .div(new BN(expectedPrice))
        .gt(toBaseUnit(PRICE_TOLERANCE, '18'))
    ) {
      return false
    }
    return true
  },

  hashRequestResult: function (request, result) {
    const {
      method,
      data: { params }
    } = request
    const { hashTimestamp, hashVolume } = params
    switch (method) {
      case 'price':
        if (
          !this.isPriceToleranceOk(
            result.tokenPrice,
            request.data.result.tokenPrice
          )
        ) {
          throw { message: 'Price threshold exceeded' }
        }
        let { token, pairs } = result
        // TODO set type of pairs based on sig

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: token },
          { type: 'address[]', value: pairs },
          { type: 'uint256', value: request.data.result.tokenPrice },

          ...(hashVolume
            ? [{ type: 'uint256', value: request.data.result.volume }]
            : []),

          ...(hashTimestamp
            ? [{ type: 'uint256', value: request.data.timestamp }]
            : [])
        ])
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

        // TODO set type of pairs based on sig
        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: token },
          { type: 'address[]', value: pairs0 },
          { type: 'address[]', value: pairs1 },
          { type: 'uint256', value: request.data.result.tokenPrice },
          ...(hashVolume
            ? [{ type: 'uint256', value: request.data.result.volume }]
            : []),
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
