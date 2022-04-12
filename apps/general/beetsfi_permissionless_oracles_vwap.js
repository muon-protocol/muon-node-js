const { axios, toBaseUnit, soliditySha3, BN, multiCall } = MuonAppUtils

const getTimestamp = () => Math.floor(Date.now() / 1000)
const TOKEN_INFO = 'tokenInfo'
const TOTAL_SUPPLY = 'totalSupply'
const PAIRS0_INFO = 'pairs0INFO'
const PAIRS1_INFO = 'pairs1INFO'
const PAIRS_INFO = 'pairsINFO'

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

const PRICE_TOLERANCE = 0.05
const FANTOM_ID = 250
const SCALE = new BN('1000000000000000000')
const GRAPH_URL =
  'https://api.thegraph.com/subgraphs/name/shayanshiravani/beetsfi'

async function getTokenTxs(poolId) {
  try {
    const currentTimestamp = getTimestamp()
    const last30Min = currentTimestamp - 1800
    const query = `
      {
        swaps(
          where: {
            poolId: "${poolId.toLowerCase()}"
            timestamp_gt: ${last30Min}
          }, 
          orderBy: timestamp, 
          orderDirection: desc
        ) {
          poolId
          from
          tokenIn {
            id
          }
          tokenOut {
            id
          }
          tokenAmountIn
          tokenAmountOut
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

function getReturnValue(info, methodName) {
  return info.find((item) => item.methodName === methodName).returnValues
}

function getInfoContract(multiCallInfo, filterBy) {
  return multiCallInfo.filter((item) => item.reference.startsWith(filterBy))
}

function getMetadata(multiCallInfo, filterBy) {
  const info = getInfoContract(multiCallInfo, filterBy)
  let metadata = info.map((item) => {
    const reserves = getReturnValue(item.callsReturnContext, 'getReserves')

    return {
      r0: reserves[0],
      r1: reserves[1],

      t0: getReturnValue(item.callsReturnContext, 'token0')[0],
      t1: getReturnValue(item.callsReturnContext, 'token1')[0]
    }
  })
  return metadata
}

function makeCallContextInfo(info, prefix) {
  const contractCallContext = info.map((item) => ({
    reference: prefix + ':' + item,
    contractAddress: item,
    abi: Info_ABI,
    calls: [
      {
        reference: prefix + ':' + item,
        methodName: 'getReserves'
      },
      {
        reference: prefix + ':' + item,
        methodName: 'token0'
      },
      {
        reference: prefix + ':' + item,
        methodName: 'token1'
      }
    ]
  }))

  return contractCallContext
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
      ]
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
      ]
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

async function tokenVWAP(token, poolId) {
  let { tokenPrice, sumVolume } = await poolVWAP(poolId, token)

  let price = new BN(SCALE)
  price = price.mul(tokenPrice).div(SCALE)

  return { price, sumVolume }
}

async function poolVWAP(poolId, token) {
  let tokenTxs = await getTokenTxs(poolId)
  if (tokenTxs) {
    let sumWeightedPrice = new BN('0')
    let sumVolume = new BN('0')
    for (var i = 0; i < tokenTxs.length; i++) {
      let swap = tokenTxs[i]
      let price = new BN('0')
      let volume = new BN('0')
      switch (token) {
        case swap.tokenIn.id:
          price = toBaseUnit(swap.tokenAmountOut, '18')
            .mul(SCALE)
            .div(toBaseUnit(swap.tokenAmountIn, '18'))
          volume = toBaseUnit(swap.tokenAmountIn, '18')
          break

        case swap.tokenOut.id:
          price = toBaseUnit(swap.tokenAmountIn, '18')
            .mul(SCALE)
            .div(toBaseUnit(swap.tokenAmountOut, '18'))
          volume = toBaseUnit(swap.tokenAmountOut, '18')
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
  }
  return { tokenPrice: new BN('0'), sumVolume }
}

async function LPTokenPrice(token, pairs0, pairs1) {
  const contractCallContextToken = makeCallContextInfo([token], TOKEN_INFO)
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
      ]
    }
  ]

  const contractCallContextPairs0 = makeCallContextInfo(pairs0, PAIRS0_INFO)

  const contractCallContextPairs1 = makeCallContextInfo(pairs1, PAIRS1_INFO)

  const contractCallContext = [
    ...contractCallContextToken,
    ...contractCallContextSupply,
    ...contractCallContextPairs0,
    ...contractCallContextPairs1
  ]

  let result = await multiCall(FANTOM_ID, contractCallContext)

  let metadata = getMetadata(result, TOKEN_INFO)

  let pairs0Metadata = getMetadata(result, PAIRS0_INFO)

  let pairs1Metadata = getMetadata(result, PAIRS1_INFO)

  const callContextDecimalToken = makeCallContextDecimal(metadata, TOKEN_INFO)

  let callContextPairs0 = makeCallContextDecimal(pairs0Metadata, PAIRS0_INFO)

  let callContextPairs1 = makeCallContextDecimal(pairs1Metadata, PAIRS1_INFO)

  const contractCallContextDecimal = [
    ...callContextDecimalToken,
    ...callContextPairs0,
    ...callContextPairs1
  ]

  let resultDecimals = await multiCall(FANTOM_ID, contractCallContextDecimal)

  metadata = getFinalMetaData(resultDecimals, metadata, TOKEN_INFO)[0]
  pairs0Metadata = getFinalMetaData(resultDecimals, pairs0Metadata, PAIRS0_INFO)
  pairs1Metadata = getFinalMetaData(resultDecimals, pairs1Metadata, PAIRS1_INFO)

  let totalSupply = getInfoContract(result, TOTAL_SUPPLY)[0].callsReturnContext
  totalSupply = new BN(totalSupply[0].returnValues[0])

  let reserveA = new BN(metadata.r0).mul(SCALE).div(new BN(metadata.dec0))

  let reserveB = new BN(metadata.r1).mul(SCALE).div(new BN(metadata.dec1))

  let totalUSDA = reserveA
  if (pairs0.length) {
    totalUSDA = (await tokenVWAP(metadata.t0, pairs0, pairs0Metadata))
      .mul(reserveA)
      .div(SCALE)
  }

  let totalUSDB = reserveB
  if (pairs1.length) {
    totalUSDB = (await tokenVWAP(metadata.t1, pairs1, pairs1Metadata))
      .mul(reserveB)
      .div(SCALE)
  }

  let totalUSD = totalUSDA.add(totalUSDB)

  return totalUSD.mul(SCALE).div(totalSupply).toString()
}

module.exports = {
  APP_NAME: 'beetsfi_permissionless_oracles_vwap',
  APP_ID: 19,

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request

    switch (method) {
      case 'price':
        let { token, poolId, hashTimestamp } = params
        // if (typeof pairs === 'string' || pairs instanceof String) {
        //   pairs = pairs.split(',')
        // }
        let { price, sumVolume } = await tokenVWAP(token, poolId)
        return {
          token,
          tokenPrice: price.toString(),
          poolId,
          volume: sumVolume.toString(),
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
        let { token, poolId, volume } = result

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: token },
          { type: 'uint256', value: poolId },
          { type: 'uint256', value: request.data.result.tokenPrice },
          { type: 'uint256', value: volume },

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
