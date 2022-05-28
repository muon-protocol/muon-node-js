const { Web3, BigNumber } = MuonAppUtils

const SpriteVWAP = require('./spirit_permissionless_oracles_vwap_v3')
const {
  GET_POOL_INFO_ABI,
  PAIRS,
  PRICING_ASSETS,
  POOL_TOKENS_ABI,
  ERC20_DECIMALS_ABI
} = require('./spirit_permissionless_oracles_vwap_v2.constant.json')
const { async } = require('regenerator-runtime')

const APP_CONFIG = {
  chainId: 250
}

const STABLE = 'stable'
const WEIGHTED = 'weighted'

const getTimestamp = () => Math.floor(Date.now() / 1000)
const bn = (value) => new BigNumber(value)
const ZERO = bn(0)
const ONE = bn(1)
const TWO = bn(2)
const ONE_18 = bn('1000000000000000000') // 1e18
const div = (a, b, roundUp) => {
  return roundUp ? divUp(a, b) : divDown(a, b)
}

const divDown = (a, b) => {
  if (b.isZero()) {
    throw new Error('ZERO_DIVISION')
  }
  return a.idiv(b)
}

const divUp = (a, b) => {
  if (b.isZero()) {
    throw new Error('ZERO_DIVISION')
  }
  return a.isZero() ? ZERO : ONE.plus(a.minus(ONE).idiv(b))
}

const fpMulDown = (a, b) => {
  return a.times(b).idiv(ONE)
}

const fpMulUp = (a, b) => {
  const product = a.times(b)
  if (product.isZero()) {
    return product
  } else {
    // The traditional divUp formula is:
    // divUp(x, y) := (x + y - 1) / y
    // To avoid intermediate overflow in the addition, we distribute the division and get:
    // divUp(x, y) := (x - 1) / y + 1
    // Note that this requires x != 0, which we already tested for

    return product.minus(bn(1)).idiv(ONE).plus(bn(1))
  }
}

const fpDivDown = (a, b) => {
  if (b.isZero()) {
    throw new Error('ZERO_DIVISION')
  }
  if (a.isZero()) {
    return a
  } else {
    return a.times(ONE).idiv(b)
  }
}

const fpDivUp = (a, b) => {
  if (b.isZero()) {
    throw new Error('ZERO_DIVISION')
  }
  if (a.isZero()) {
    return a
  } else {
    // The traditional divUp formula is:
    // divUp(x, y) := (x + y - 1) / y
    // To avoid intermediate overflow in the addition, we distribute the division and get:
    // divUp(x, y) := (x - 1) / y + 1
    // Note that this requires x != 0, which we already tested for.

    return a.times(ONE).minus(bn(1)).idiv(b).plus(bn(1))
  }
}

const fpPowUp = (x, y) => {
  const raw = logExpPow(x, y)
  const maxError = fpMulUp(raw, MAX_POW_RELATIVE_ERROR).plus(ONE)

  return raw.plus(maxError)
}

const fpComplement = (x) => {
  return x.lt(ONE) ? ONE.minus(x) : ZERO
}

// TODO add fun LogExpPow

module.exports = {
  ...SpriteVWAP,

  APP_NAME: 'beetsfi_permissionless_oracles_vwap_v3',
  APP_ID: 32,
  config: APP_CONFIG,

  upScale: function (amount, decimals) {
    return bn(amount).times(this.SCALE).div(bn(decimals))
  },

  makeCallContextInfo: function (pair, prefix) {
    let calls = []
    let pairCache = []

    pair.forEach((item) => {
      if (!pairCache.includes(item.address)) {
        pairCache.push(item.address)
        let param
        switch (item.pool) {
          case STABLE:
            param = {
              reference: prefix + ':' + item.address,
              methodName: 'getAmplificationParameter'
            }
            break

          case WEIGHTED:
            param = {
              reference: prefix + ':' + item.address,
              methodName: 'getNormalizedWeights'
            }
            break

          default:
            break
        }
        calls.push({
          reference: prefix + '_' + item.exchange + ':' + item.address,
          contractAddress: item.address,
          abi: GET_POOL_INFO_ABI,
          calls: [
            {
              reference: prefix + ':' + item.address,
              methodName: 'getPoolId'
            },
            {
              reference: prefix + ':' + item.address,
              methodName: 'getVault'
            },
            param
          ],
          context: {
            pair: item.address,
            exchange: item.exchange,
            chainId: item.chainId,
            pool: item.pool
          }
        })
      }
    })

    return calls
  },

  makeCallContextMeta: function (poolInfo, prefix) {
    let calls = []
    poolInfo.forEach((item) => {
      let param = {}
      switch (item.pool) {
        case STABLE:
          param = {
            ampValue: bn(item.ampValue),
            ampPrecision: bn(item.ampPrecision)
          }
          break
        case WEIGHTED:
          param = { weighted: item.weighted }
          break

        default:
          break
      }
      calls.push({
        reference: prefix + '_' + item.exchange + ':' + item.pair,
        contractAddress: item.vault,
        abi: POOL_TOKENS_ABI,
        calls: [
          {
            reference: prefix + ':' + item.poolId,
            methodName: 'getPoolTokens',
            methodParameters: [item.poolId]
          }
        ],
        context: {
          pair: item.pair,
          exchange: item.exchange,
          chainId: item.chainId,
          pool: item.pool,
          ...param
        }
      })
    })
    return calls
  },

  getMetadata: function (multiCallInfo, filterBy) {
    const info = this.getInfoContract(multiCallInfo, filterBy)
    let metadata = info.map((item) => {
      const poolTokens = this.getReturnValue(
        item.callsReturnContext,
        'getPoolTokens'
      )
      const balances = poolTokens[1].map((balanceObj) =>
        Web3.utils.hexToNumberString(balanceObj.hex)
      )
      let param = {}
      switch (item.context.pool) {
        case STABLE:
          param = {
            ampValue: item.context.ampValue,
            ampPrecision: item.context.ampPrecision
          }
          break
        case WEIGHTED:
          param = { weighted: item.context.weighted }
          break

        default:
          break
      }
      return {
        reference: item.reference,
        pair: item.context.pair,
        exchange: item.context.exchange,
        chainId: item.context.chainId,
        pool: item.context.pool,
        ...param,
        tokens: poolTokens[0],
        balances
      }
    })
    return metadata
  },

  makeCallContextDecimal: function (metadata, prefix) {
    let callContext = metadata.map((pool) => {
      const callData = pool.tokens.map((token) => ({
        reference: prefix + '_' + token,
        contractAddress: token,
        abi: ERC20_DECIMALS_ABI,
        calls: [
          {
            reference: token,
            methodName: 'decimals'
          }
        ],
        context: {
          exchange: pool.exchange,
          chainId: pool.chainId
        }
      }))
      return callData
    })
    callContext = [].concat.apply([], callContext)
    return callContext
  },

  getFinalMetaData: function (resultDecimals, prevMetaData, prefix) {
    let metadata = prevMetaData.map((item) => {
      const tokensInfo = item.tokens.map((token, index) => {
        const info = this.getInfoContract(resultDecimals, prefix + '_' + token)
        const decimals = info[0].callsReturnContext[0].returnValues[0]
        const weighted =
          item.pool === WEIGHTED ? { weighted: item.weighted[index] } : {}
        return {
          token,
          index: index,
          decimals: bn(10).pow(bn(decimals)).toString(),
          balance: item.balances[index],
          ...weighted
        }
      })
      return {
        ...item,
        tokensInfo
      }
    })

    return metadata
  },

  prepareMetadataForTokenVWAP: async function (pairs) {
    const contractCallContext = this.makeCallContextInfo(pairs, PAIRS)
    let result = await this.runMultiCall(contractCallContext)
    const poolInfo = result.map((item) => {
      const poolId = this.getReturnValue(
        item.callsReturnContext,
        'getPoolId'
      )[0]
      const vault = this.getReturnValue(item.callsReturnContext, 'getVault')[0]
      let param = {}
      switch (item.context.pool) {
        case STABLE:
          const [ampValue, isUpdating, ampPrecision] = this.getReturnValue(
            item.callsReturnContext,
            'getAmplificationParameter'
          )
          param = { ampValue, ampPrecision }
          break

        case WEIGHTED:
          const weighted = this.getReturnValue(
            item.callsReturnContext,
            'getNormalizedWeights'
          )
          param = { weighted }

        default:
          break
      }

      return { poolId, vault, ...param, ...item.context }
    })
    const callContextMeta = this.makeCallContextMeta(poolInfo, PAIRS)

    const multiCallInfo = await this.runMultiCall(callContextMeta)
    let metadata = this.getMetadata(multiCallInfo, PAIRS)
    let callContextPairs = this.makeCallContextDecimal(metadata, PAIRS)

    let resultDecimals = await this.runMultiCall(callContextPairs)

    metadata = this.getFinalMetaData(resultDecimals, metadata, PAIRS)

    // console.log(JSON.stringify(metadata, undefined, 2))
    return metadata
  },

  makePromisePair: function (token, pairs, metadata, start, end) {
    return pairs.map((pair) => {
      let currentMetadata = metadata.find(
        (item) =>
          item.reference === PAIRS + '_' + pair.exchange + ':' + pair.address
      )
      return this.pairVWAP(
        token,
        pair.address,
        pair.exchange,
        pair.chainId,
        currentMetadata,
        start,
        end
      )
    })
  },

  // isPricingAsset: function (asset) {
  //   for (let i = 0; i < PRICING_ASSETS.length; i++) {
  //     if (PRICING_ASSETS[i] == asset) return true
  //   }
  //   return false
  // },

  calculateInvariant: function (
    amplificationParameter,
    ampPrecision,
    balances,
    roundUp
  ) {
    /**********************************************************************************************
    // invariant                                                                                 //
    // D = invariant                                                  D^(n+1)                    //
    // A = amplification coefficient      A  n^n S + D = A D n^n + -----------                   //
    // S = sum of balances                                             n^n P                     //
    // P = product of balances                                                                   //
    // n = number of tokens                                                                      //
    **********************************************************************************************/

    // We support rounding up or down.

    const numTokens = bn(balances.length)

    let sum = balances.reduce(
      (previousValue, currentValue) => previousValue.plus(currentValue),
      ZERO
    )
    if (sum.isZero()) return ZERO
    let prevInvariant = ZERO
    let invariant = sum
    let ampTimesTotal = amplificationParameter.times(numTokens)
    for (let i = 0; i < 255; i++) {
      let P_D = balances[0].times(numTokens)
      for (let j = 1; j < balances.length; j++) {
        //                  P_D * balances[j] * numTokens       //
        //       P_D =  --------------------------------------                   //
        //                        invariant
        P_D = div(P_D.times(balances[j]).times(numTokens), invariant, roundUp)
      }
      prevInvariant = invariant
      //                                                           ampTimesTotal * sum * P_D
      //                (numTokens * invariant * invariant ) +  ------------------------------                  //
      //                                                              AMP_PRECISION
      // invariant =   --------------------------------------------------------------------------------                  //
      //                                                    (ampTimesTotal - AMP_PRECISION) * P_D)
      //                ((numTokens + 1) * invariant) +   ----------------------------------------
      //                                                                AMP_PRECISION
      invariant = div(
        numTokens
          .times(invariant)
          .times(invariant)
          .plus(
            div(ampTimesTotal.times(sum).times(P_D), ampPrecision, roundUp)
          ),

        numTokens
          .plus(ONE)
          .times(invariant)
          .plus(
            div(
              ampTimesTotal.minus(ampPrecision).times(P_D),
              ampPrecision,
              !roundUp
            )
          ),

        roundUp
      )
      if (invariant.gt(prevInvariant)) {
        if (invariant.minus(prevInvariant).lte(ONE)) return invariant
      } else if (prevInvariant.minus(invariant).lte(ONE)) return invariant
    }
    throw new Error("STABLE_GET_BALANCE_DIDN'T_CONVERGE")
  },

  getTokenBalanceGivenInvariantAndAllOtherBalances: function (
    amplificationParameter,
    ampPrecision,
    balances,
    invariant,
    tokenIndex
  ) {
    const numTokens = bn(balances.length)
    let ampTimesTotal = amplificationParameter.times(numTokens)
    let sum = balances[0]
    let P_D = balances[0].times(numTokens)
    for (let j = 1; j < balances.length; j++) {
      //        P_D * balances[j] * numTokens
      // P_D = --------------------------------  //floor
      //            invariant
      P_D = divDown(P_D.times(balances[j]).times(numTokens), invariant)
      sum = sum.plus(balances[j])
    }

    sum = sum.minus(balances[tokenIndex])
    const inv2 = invariant.times(invariant)
    // We remove the balance fromm c by multiplying it
    //             inv2
    // c =  ----------------------------- * AMP_PRECISION * Balances[tokenIndex] // Ceil
    //       ampTimesTotal  * P_D
    const c = divUp(inv2, ampTimesTotal.times(P_D))
      .times(ampPrecision)
      .times(balances[tokenIndex])
    //             invariant
    // b = sum + --------------- * AMP_PRECISION // floor
    //            ampTimesTotal
    const b = sum.plus(divDown(invariant, ampTimesTotal).times(ampPrecision))
    // We iterate to find the balance

    let prevTokenBalance = ZERO
    // We multiply the first iteration outside the loop with the invariant to set the value of the
    // initial approximation.

    //                       inv2 + c
    //  tokenBalance = --------------------     // Ceil
    //                    invariant +b

    let tokenBalance = div(inv2.plus(c), invariant.plus(b))
    // TODO why use this for
    for (let i = 0; i < 255; i++) {
      prevTokenBalance = tokenBalance
      //                     ((tokenBalance * tokenBalance) + c)
      // tokenBalance = ----------------------------------------------  //ceil
      //                      ((tokenBalance * 2) + b - invariant)
      tokenBalance = divUp(
        tokenBalance.times(tokenBalance).plus(c),
        tokenBalance.times(TWO).plus(b).minus(invariant)
      )

      if (tokenBalance.gt(prevTokenBalance)) {
        if (tokenBalance.minus(prevTokenBalance).lte(ONE)) return tokenBalance
      } else if (prevTokenBalance.minus(tokenBalance).lte(ONE))
        return tokenBalance
    }

    throw new Error("STABLE_GET_BALANCE_DIDN'T_CONVERGE")
  },

  calcOutGivenIn: function (
    amplificationParameter,
    ampPrecision,
    balances,
    tokenIndexIn,
    tokenIndexOut,
    tokenAmountIn,
    invariant
  ) {
    balances[tokenIndexIn] = balances[tokenIndexIn].plus(tokenAmountIn)
    finalBalanceOut = this.getTokenBalanceGivenInvariantAndAllOtherBalances(
      amplificationParameter,
      ampPrecision,
      [...balances],
      invariant,
      tokenIndexOut
    )

    balances[tokenIndexIn] = balances[tokenIndexIn].minus(tokenAmountIn)
    return balances[tokenIndexOut].minus(finalBalanceOut).minus(ONE)
  },

  tokenPriceStable: function (
    ampValue,
    ampPrecision,
    amount,
    balances,
    indexIn,
    indexOut
  ) {
    const invariant = this.calculateInvariant(
      ampValue,
      ampPrecision,
      balances,
      true
    )

    const amountOut = this.calcOutGivenIn(
      ampValue,
      ampPrecision,
      [...balances],
      indexIn,
      indexOut,
      amount,
      invariant
    )
    // TODO Do we need fee network??????????
    // return amountOut.times(bn(0.9999))
    return amountOut
  },

  tokenPriceWeighted: function (
    balanceIn,
    weightIn,
    balanceOut,
    weightOut,
    amountIn
  ) {},

  pairVWAP: async function (
    token,
    pair,
    exchange,
    chainId,
    metadata,
    start,
    end
  ) {
    const currentTimestamp = getTimestamp()
    const endTime = end ? end : currentTimestamp
    const startTime = start ? start : currentTimestamp - 1800

    // TODO based on subgraph prepare this fun
    // const tokenTxs = await this.prepareTokenTx(
    //   pair,
    //   exchange,
    //   chainId,
    //   startTime,
    //   endTime
    // )
    // if (tokenTxs) {
    let sumWeightedPrice = bn('0')
    let sumVolume = bn('0')
    // for (let i = 0; i < tokenTxs.length; i++) {
    //   let swap = tokenTxs[i]
    //   if (
    //     (swap.amount0In != 0 && swap.amount1In != 0) ||
    //     (swap.amount0Out != 0 && swap.amount1Out != 0) ||
    //     (swap.amount0In != 0 && swap.amount0Out != 0) ||
    //     (swap.amount1In != 0 && swap.amount1Out != 0)
    //   ) {
    //     continue
    //   }
    // TODO based on subgraph filter these things from metadata

    let swap = {
      balances: metadata.tokensInfo.map((t) =>
        this.upScale(t.balance, t.decimals)
      ),
      amount: '1000000000000000000',
      tokenInBalance: metadata.tokensInfo[1].balance,
      tokenOutBalance: metadata.tokensInfo[0].balance,

      tokenIn: metadata.tokensInfo[1].token,
      tokenOut: metadata.tokensInfo[0].token
    }

    const tokenIn = metadata.tokensInfo.find(
      (item) => item.token === swap.tokenIn
    )
    const tokenOut = metadata.tokensInfo.find(
      (item) => item.token === swap.tokenOut
    )

    let price
    switch (metadata.pool) {
      case STABLE:
        price = this.tokenPriceStable(
          metadata.ampValue,
          metadata.ampPrecision,
          swap.amount,
          [...swap.balances],

          tokenIn.index,
          tokenOut.index
        )
        break
      case WEIGHTED:
        //  TODO double check to be sure about weighted decimal
        price = this.tokenPriceWeighted(
          this.upScale(swap.tokenInBalance, tokenIn.decimals),
          tokenIn.weighted,
          this.upScale(swap.tokenOutBalance, tokenOut.decimals),
          tokenOut.weighted,
          swap.amount
        )
        break

      default:
        break
    }

    console.log({ price: price.toString() })
  }
}
