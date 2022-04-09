const { axios, toBaseUnit, soliditySha3, BN, multiCall } = MuonAppUtils

const getTimestamp = () => Math.floor(Date.now() / 1000)
const TOKEN_INFO = 'tokenInfo'
const TOTAL_SUPPLY = 'totalSupply'
const PAIRS0_INFO = 'pairs0INFO'
const PAIRS1_INFO = 'pairs1INFO'

const SPIRIT_ABI = [
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
  'https://api.thegraph.com/subgraphs/name/shayanshiravani/spiritswap'

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

function getReturnValue(info, methodName) {
  return info.find((item) => item.methodName === methodName).returnValues
}

function getInfoContract(multiCallInfo, filterBy) {
  return multiCallInfo.filter((item) => item.reference.startsWith(filterBy))
}

async function tokenVWAP(token, pairs, metadata) {
  var pairPrices = []
  var inputToken = token
  if (!metadata) {
    const contractCallContext = pairs.map((pair) => ({
      reference: pair,
      contractAddress: pair,
      abi: SPIRIT_ABI,
      calls: [
        {
          reference: pair,
          methodName: 'getReserves'
        },
        {
          reference: pair,
          methodName: 'token0'
        },
        {
          reference: pair,
          methodName: 'token1'
        }
      ]
    }))
    let result = await multiCall(FANTOM_ID, contractCallContext)

    let pairMetadata = result.map((item) => {
      const reserves = getReturnValue(item.callsReturnContext, 'getReserves')

      return {
        r0: reserves[0],
        r1: reserves[1],

        t0: getReturnValue(item.callsReturnContext, 'token0')[0],
        t1: getReturnValue(item.callsReturnContext, 'token1')[0]
      }
    })

    let callContextPairs = pairMetadata.map((pair) => [
      {
        reference: 't0' + ':' + pair.t0,
        contractAddress: pair.t0,
        abi: ERC20_DECIMALS_ABI,
        calls: [
          {
            reference: 't0' + ':' + pair.t0,
            methodName: 'decimals'
          }
        ]
      },
      {
        reference: 't1' + ':' + pair.t1,
        contractAddress: pair.t1,
        abi: ERC20_DECIMALS_ABI,
        calls: [
          {
            reference: 't1' + ':' + pair.t1,
            methodName: 'decimals'
          }
        ]
      }
    ])

    callContextPairs = [].concat.apply([], callContextPairs)
    let resultDecimals = await multiCall(FANTOM_ID, callContextPairs)
    metadata = pairMetadata.map((item) => {
      let t0 = getInfoContract(resultDecimals, 't0' + ':' + item.t0)
      let t1 = getInfoContract(resultDecimals, 't1' + ':' + item.t1)
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
      reference: TOKEN_INFO + ':' + token,
      contractAddress: token,
      abi: SPIRIT_ABI,
      calls: [
        {
          reference: TOKEN_INFO + ':' + token,
          methodName: 'getReserves'
        },
        {
          reference: TOKEN_INFO + ':' + token,
          methodName: 'token0'
        },
        {
          reference: TOKEN_INFO + ':' + token,
          methodName: 'token1'
        }
      ]
    },
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
  const contractCallContextPairs0 = pairs0.map((pair) => ({
    reference: PAIRS0_INFO + ':' + pair,
    contractAddress: pair,
    abi: SPIRIT_ABI,
    calls: [
      {
        reference: PAIRS0_INFO + ':' + pair,
        methodName: 'getReserves'
      },
      {
        reference: PAIRS0_INFO + ':' + pair,
        methodName: 'token0'
      },
      {
        reference: PAIRS0_INFO + ':' + pair,
        methodName: 'token1'
      }
    ]
  }))

  const contractCallContextPairs1 = pairs1.map((pair) => {
    return {
      reference: PAIRS1_INFO + ':' + pair,
      contractAddress: pair,
      abi: SPIRIT_ABI,
      calls: [
        {
          reference: PAIRS1_INFO + ':' + pair,
          methodName: 'getReserves'
        },
        {
          reference: PAIRS1_INFO + ':' + pair,
          methodName: 'token0'
        },
        {
          reference: PAIRS1_INFO + ':' + pair,
          methodName: 'token1'
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

  let tokenInfo = getInfoContract(result, TOKEN_INFO)[0].callsReturnContext

  const reserves = getReturnValue(tokenInfo, 'getReserves')
  let metadata = {
    r0: reserves[0],
    r1: reserves[1],
    // st: tokenMetaData.callsReturnContext[0].returnValues[4],
    t0: getReturnValue(tokenInfo, 'token0')[0],
    t1: getReturnValue(tokenInfo, 'token1')[0]
  }
  const pairs0Info = getInfoContract(result, PAIRS0_INFO)

  let pairs0Metadata = pairs0Info.map((item) => {
    const reserves = getReturnValue(item.callsReturnContext, 'getReserves')

    return {
      r0: reserves[0],
      r1: reserves[1],

      t0: getReturnValue(item.callsReturnContext, 'token0')[0],
      t1: getReturnValue(item.callsReturnContext, 'token1')[0]
    }
  })

  const pairs1Info = getInfoContract(result, PAIRS1_INFO)

  let pairs1Metadata = pairs1Info.map((item) => {
    const reserves = getReturnValue(item.callsReturnContext, 'getReserves')
    return {
      r0: reserves[0],
      r1: reserves[1],
      t0: getReturnValue(item.callsReturnContext, 'token0')[0],
      t1: getReturnValue(item.callsReturnContext, 'token1')[0]
    }
  })

  const callContextDecimalToken = [
    {
      reference: TOKEN_INFO + ':' + metadata.t0,
      contractAddress: metadata.t0,
      abi: ERC20_DECIMALS_ABI,
      calls: [
        {
          reference: 't0' + ':' + metadata.t0,
          methodName: 'decimals'
        }
      ]
    },
    {
      reference: TOKEN_INFO + ':' + metadata.t1,
      contractAddress: metadata.t1,
      abi: ERC20_DECIMALS_ABI,
      calls: [
        {
          reference: 't1' + ':' + metadata.t1,
          methodName: 'decimals'
        }
      ]
    }
  ]

  let callContextPairs0 = pairs0Metadata.map((pair) => [
    {
      reference: PAIRS0_INFO + ':' + 't0' + ':' + pair.t0,
      contractAddress: pair.t0,
      abi: ERC20_DECIMALS_ABI,
      calls: [
        {
          reference: 't0' + ':' + pair.t0,
          methodName: 'decimals'
        }
      ]
    },
    {
      reference: PAIRS0_INFO + ':' + 't1' + ':' + pair.t1,
      contractAddress: pair.t1,
      abi: ERC20_DECIMALS_ABI,
      calls: [
        {
          reference: 't1' + ':' + pair.t1,
          methodName: 'decimals'
        }
      ]
    }
  ])

  callContextPairs0 = [].concat.apply([], callContextPairs0)

  let callContextPairs1 = pairs1Metadata.map((pair) => {
    return [
      {
        reference: PAIRS1_INFO + ':' + 't0' + ':' + pair.t0,
        contractAddress: pair.t0,
        abi: ERC20_DECIMALS_ABI,
        calls: [
          {
            reference: 't0' + ':' + pair.t0,
            methodName: 'decimals'
          }
        ]
      },
      {
        reference: PAIRS1_INFO + ':' + 't1' + ':' + pair.t1,
        contractAddress: pair.t1,
        abi: ERC20_DECIMALS_ABI,
        calls: [
          {
            reference: 't1' + ':' + pair.t1,
            methodName: 'decimals'
          }
        ]
      }
    ]
  })

  callContextPairs1 = [].concat.apply([], callContextPairs1)

  const contractCallContextDecimal = [
    ...callContextDecimalToken,
    ...callContextPairs0,
    ...callContextPairs1
  ]

  let resultDecimals = await multiCall(FANTOM_ID, contractCallContextDecimal)
  let t0 = getInfoContract(resultDecimals, TOKEN_INFO + ':' + metadata.t0)
  let t1 = getInfoContract(resultDecimals, TOKEN_INFO + ':' + metadata.t1)
  metadata = {
    ...metadata,
    dec0: new BN(10)
      .pow(new BN(getReturnValue(t0[0].callsReturnContext, 'decimals')[0]))
      .toString(),
    dec1: new BN(10)
      .pow(new BN(getReturnValue(t1[0].callsReturnContext, 'decimals')[0]))
      .toString()
  }

  let p0Metadata = pairs0Metadata.map((item) => {
    let t0 = getInfoContract(
      resultDecimals,
      PAIRS0_INFO + ':' + 't0' + ':' + item.t0
    )
    let t1 = getInfoContract(
      resultDecimals,
      PAIRS0_INFO + ':' + 't1' + ':' + item.t1
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

  let p1Metadata = pairs1Metadata.map((item) => {
    let t0 = getInfoContract(
      resultDecimals,
      PAIRS1_INFO + ':' + 't0' + ':' + item.t0
    )
    let t1 = getInfoContract(
      resultDecimals,
      PAIRS1_INFO + ':' + 't1' + ':' + item.t1
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

  let totalSupply = getInfoContract(result, TOTAL_SUPPLY)[0].callsReturnContext
  totalSupply = new BN(totalSupply[0].returnValues[0])

  let reserveA = new BN(metadata.r0).mul(SCALE).div(new BN(metadata.dec0))

  let reserveB = new BN(metadata.r1).mul(SCALE).div(new BN(metadata.dec1))

  let totalUSDA = reserveA
  if (pairs0.length) {
    totalUSDA = (await tokenVWAP(metadata.t0, pairs0, p0Metadata))
      .mul(reserveA)
      .div(SCALE)
  }

  let totalUSDB = reserveB
  if (pairs1.length) {
    totalUSDB = (await tokenVWAP(metadata.t1, pairs1, p1Metadata))
      .mul(reserveB)
      .div(SCALE)
  }

  let totalUSD = totalUSDA.add(totalUSDB)

  return totalUSD.mul(SCALE).div(totalSupply).toString()
}

module.exports = {
  APP_NAME: 'spirit_permissionless_oracles_vwap',
  APP_ID: 17,

  onRequest: async function (request) {
    let {
      method,
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
