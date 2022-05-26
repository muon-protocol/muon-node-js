const { Web3, toBaseUnit, getWeb3, BigNumber, BN } = MuonAppUtils

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

const getTimestamp = () => Math.floor(Date.now() / 1000)
const bn = (value) => new BigNumber(value)
const ZERO = bn(0)
const ONE = bn(1)
const TWO = bn(2)
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

const scale = (value, decimalPlaces) =>
  bn(value).times(bn(10).pow(decimalPlaces))

const upScale = (amount, decimals) => {
  return scale(amount, decimals).times(bn(10).pow(18 - decimals))
}

const downScaleDown = (amount, decimals) => {
  return scale(divDown(bn(amount), bn(10).pow(18 - decimals)), -decimals)
}

module.exports = {
  ...SpriteVWAP,

  APP_NAME: 'beetsfi_permissionless_oracles_vwap_v3',
  APP_ID: 32,
  config: APP_CONFIG,
  // TODO how to set this value
  startValue: 100000,
  endValue: 100000,
  AMP_PRECISION: 1000,

  makeCallContextInfo: function (pair, prefix) {
    let calls = []
    let pairCache = []

    pair.forEach((item) => {
      if (!pairCache.includes(item.address)) {
        pairCache.push(item.address)
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
            }
          ],
          context: {
            pair: item.address,
            exchange: item.exchange,
            chainId: item.chainId
          }
        })
      }
    })

    return calls
  },

  makeCallContextMeta: function (poolInfo, prefix) {
    let calls = []
    poolInfo.forEach((item) => {
      // TODO check do we need stable here or not
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
          chainId: item.chainId
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
      return {
        reference: item.reference,
        pair: item.context.pair,
        exchange: item.context.exchange,
        chainId: item.context.chainId,
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
    let metadata = prevMetaData.map((pool) => {
      const decimals = pool.tokens.map((token, index) => {
        const info = this.getInfoContract(resultDecimals, prefix + '_' + token)
        const decimal = info[0].callsReturnContext[0].returnValues[0]
        return {
          token,
          decimal: new BN(10).pow(new BN(decimal)).toString(),
          balance: pool.balances[index]
        }
      })
      return {
        ...pool,
        tokensInfo: decimals
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
      return { poolId, vault, ...item.context }
    })
    const callContextMeta = this.makeCallContextMeta(poolInfo, PAIRS)

    const multiCallInfo = await this.runMultiCall(callContextMeta)
    let metadata = this.getMetadata(multiCallInfo, PAIRS)
    let callContextPairs = this.makeCallContextDecimal(metadata, PAIRS)

    let resultDecimals = await this.runMultiCall(callContextPairs)

    metadata = this.getFinalMetaData(resultDecimals, metadata, PAIRS)
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

  getAmplificationParameter: function (startTime, endTime, blockTimestamp) {
    let isUpdating, value
    if (blockTimestamp < endTime) {
      isUpdating = true
      if (this.endValue > this.startValue)
        value =
          this.startValue +
          ((this.endValue - this.startValue) * (blockTimestamp - startTime)) /
            (endTime - startTime)
      else
        value =
          this.startValue -
          ((this.startValue - this.endValue) * (blockTimestamp - startTime)) /
            (endTime - startTime)
    } else {
      isUpdating = false
      value = this.endValue
    }

    return { currentAmp: value, isUpdating }
  },

  calculateInvariant: function (amplificationParameter, balances, roundUp) {
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
            div(
              ampTimesTotal.times(sum).times(P_D),
              bn(this.AMP_PRECISION),
              roundUp
            )
          ),

        numTokens
          .plus(ONE)
          .times(invariant)
          .plus(
            div(
              ampTimesTotal.minus(bn(this.AMP_PRECISION)).times(P_D),
              bn(this.AMP_PRECISION),
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
      .times(bn(this.AMP_PRECISION))
      .times(balances[tokenIndex])
    //             invariant
    // b = sum + --------------- * AMP_PRECISION // floor
    //            ampTimesTotal
    const b = sum.plus(
      divDown(invariant, ampTimesTotal).times(bn(this.AMP_PRECISION))
    )
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
    balances,
    tokenIndexIn,
    tokenIndexOut,
    tokenAmountIn,
    invariant
  ) {
    balances[tokenIndexIn] = balances[tokenIndexIn].plus(tokenAmountIn)
    finalBalanceOut = this.getTokenBalanceGivenInvariantAndAllOtherBalances(
      amplificationParameter,
      [...balances],
      invariant,
      tokenIndexOut
    )

    balances[tokenIndexIn] = balances[tokenIndexIn].minus(tokenAmountIn)
    return balances[tokenIndexOut].minus(finalBalanceOut).minus(ONE)
  },

  tokenPrice: function (
    startTime,
    endTime,
    blockTimestamp,
    amount,
    balances,
    indexIn,
    indexOut
  ) {
    let { currentAmp } = this.getAmplificationParameter(
      startTime,
      endTime,
      blockTimestamp
    )
    currentAmp = bn(currentAmp)
    const invariant = this.calculateInvariant(currentAmp, balances, true)

    const amountOut = this.calcOutGivenIn(
      currentAmp,
      [...balances],
      indexIn,
      indexOut,
      amount,
      invariant
    )
    // TODO why * .9999
    // return amountOut.times(bn(0.9999))
    return amountOut
  },

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
    let web3 = await getWeb3(this.config.chainId)
    let lastBlock = await web3.eth.getBlock('latest')

    console.log(metadata)
    let swap = {
      blockTimestamp: lastBlock.timestamp,
      reserve0: new BN(metadata.tokensInfo[0].balance)
        .mul(this.SCALE)
        .div(new BN(metadata.tokensInfo[0].decimal))
        .toString(),
      reserve1: new BN(metadata.tokensInfo[1].balance)
        .mul(this.SCALE)
        .div(new BN(metadata.tokensInfo[1].decimal))
        .toString(),
      amount: '1000000000000000000',
      tokenIn: metadata.tokensInfo[1].token,
      tokenOut: metadata.tokensInfo[0].token
    }
    console.log(swap)
    let indexIn = metadata.tokens.findIndex((item) => item === swap.tokenIn)
    let indexOut = metadata.tokens.findIndex((item) => item === swap.tokenOut)
    let price = this.tokenPrice(
      startTime,
      endTime,
      swap.blockTimestamp,
      swap.amount,
      [bn(swap.reserve0), bn(swap.reserve1)],

      indexIn,
      indexOut
    )
    console.log({ price: price.toString() })
  }
}
