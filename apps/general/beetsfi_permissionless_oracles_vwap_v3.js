const { Web3, BN, toBaseUnit, getWeb3 } = MuonAppUtils

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
  isPricingAsset: function (asset) {
    for (let i = 0; i < PRICING_ASSETS.length; i++) {
      if (PRICING_ASSETS[i] == asset) return true
    }
    return false
  },

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

  calculateInvariant: function (amplificationParameter, balances) {
    const numTokens = balances.length

    let sum = balances.reduce(
      (previousValue, currentValue) => previousValue.add(new BN(currentValue)),
      new BN(0)
    )
    if (sum.eq(new BN(0))) return 0
    let prevInvariant = new BN(0)
    let invariant = sum
    let ampTimesTotal = new BN(amplificationParameter).mul(new BN(numTokens))
    for (let i = 0; i < 255; i++) {
      let P_D = new BN(balances[0]).mul(new BN(numTokens))
      for (let j = 1; j < numTokens; j++) {
        //                  P_D * balances[j] * numTokens       //
        //       P_D =  --------------------------------------                   //
        //                        invariant
        P_D = P_D.mul(new BN(balances[j])).mul(new BN(numTokens)).div(invariant)
      }
      prevInvariant = invariant
      //                                                    ampTimesTotal * sum * P_D
      //                (numTokens * invariant ^ 2 ) +  ------------------------------                  //
      //                                                          AMP_PRECISION
      // invariant =   --------------------------------------------------------------------------------                  //
      //                                                     (ampTimesTotal - AMP_PRECISION) * P_D)
      //                ((numTokens + 1) * invariant) +   ----------------------------------------
      //                                                                       AMP_PRECISION
      invariant = new BN(numTokens)
        .mul(new BN(invariant).pow(new BN(2)))
        .add(ampTimesTotal.mul(sum).mul(P_D).div(new BN(this.AMP_PRECISION)))
        .div(
          new BN(numTokens)
            .add(new BN(1))
            .mul(invariant)
            .add(
              ampTimesTotal
                .sub(new BN(this.AMP_PRECISION))
                .mul(P_D)
                .div(new BN(this.AMP_PRECISION))
            )
        )
      if (invariant.gt(prevInvariant)) {
        if (invariant.sub(prevInvariant).lte(new BN(1))) return invariant
      } else if (prevInvariant.sub(invariant).lte(new BN(1))) return invariant
    }
    return invariant
  },

  getTokenBalanceGivenInvariantAndAllOtherBalances: function (
    amplificationParameter,
    balances,
    invariant,
    tokenIndex
  ) {
    const balanceLen = balances.length
    let ampTimesTotal = new BN(amplificationParameter).mul(new BN(balanceLen))
    let sum = new BN(balances[0])
    let P_D = new BN(balances[0]).mul(new BN(balanceLen))
    for (let j = 1; j < balanceLen; j++) {
      P_D = P_D.mul(new BN(balances[j])).mul(new BN(balanceLen)).div(invariant)
      sum = sum.add(new BN(balances[j]))
    }

    sum = sum.sub(new BN(balances[tokenIndex]))
    let inv2 = invariant.pow(new BN(2))
    let c = inv2
      .div(ampTimesTotal.mul(P_D))
      .mul(new BN(this.AMP_PRECISION))
      .mul(new BN(balances[tokenIndex]))
    //             invariant
    // b = sum + --------------- * AMP_PRECISION
    //            ampTimesTotal
    let b = sum.add(
      invariant.div(ampTimesTotal).mul(new BN(this.AMP_PRECISION))
    )

    let prevTokenBalance = new BN(0)
    let tokenBalance = inv2.add(c).div(invariant.add(b))
    // TODO why use this for
    for (let i = 0; i < 255; i++) {
      prevTokenBalance = tokenBalance
      //                     ((tokenBalance * tokenBalance) + c)
      // tokenBalance = ----------------------------------------------
      //                      ((tokenBalance * 2) + b - invariant)
      tokenBalance = tokenBalance
        .mul(tokenBalance)
        .add(c)
        .div(tokenBalance.mul(new BN(2)).add(b).sub(invariant))

      if (tokenBalance.gt(prevTokenBalance)) {
        if (tokenBalance.sub(prevTokenBalance).lte(new BN(1)))
          return tokenBalance
      } else if (prevTokenBalance.sub(tokenBalance).lte(new BN(1)))
        return tokenBalance
    }

    return tokenBalance
  },

  calcOutGivenIn: function (
    amplificationParameter,
    balances,
    tokenIndexIn,
    tokenIndexOut,
    tokenAmountIn,
    invariant
  ) {
    balances[tokenIndexIn] = new BN(balances[tokenIndexIn]).add(
      new BN(tokenAmountIn)
    )
    finalBalanceOut = this.getTokenBalanceGivenInvariantAndAllOtherBalances(
      amplificationParameter,
      [...balances],
      invariant,
      tokenIndexOut
    )

    balances[tokenIndexIn] = balances[tokenIndexIn].sub(new BN(tokenAmountIn))
    return new BN(balances[tokenIndexOut]).sub(finalBalanceOut).sub(new BN(1))
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
    const { currentAmp } = this.getAmplificationParameter(
      startTime,
      endTime,
      blockTimestamp
    )

    const invariant = this.calculateInvariant(currentAmp, balances)

    const amountOut = this.calcOutGivenIn(
      currentAmp,
      [...balances],
      indexIn,
      indexOut,
      amount,
      invariant
    )
    // TODO why * .9999
    return amountOut.mul(toBaseUnit('0.9999', 4)).div(new BN(10).pow(new BN(4)))
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
    let sumWeightedPrice = new BN('0')
    let sumVolume = new BN('0')
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
    let indexIn = metadata.tokens.findIndex((item) => item === swap.tokenIn)
    let indexOut = metadata.tokens.findIndex((item) => item === swap.tokenOut)
    // let dec0 = new BN(metadata.dec0)
    // let dec1 = new BN(metadata.dec1)
    // let reserve0 = new BN(swap.reserve0).mul(this.SCALE).div(dec0)
    // let reserve1 = new BN(swap.reserve1).mul(this.SCALE).div(dec1)
    let price = this.tokenPrice(
      startTime,
      endTime,
      swap.blockTimestamp,
      swap.amount,
      [swap.reserve0, swap.reserve1],

      indexIn,
      indexOut
    )
    console.log({ price: price.toString() })
    // TODO to complete this part I need to know which data exist in subgraph for every pairs
    // let price = this.tokenPrice(metadata.stable, index, reserve0, reserve1)
    // let volume = new BN('0')
    // switch (index) {
    //   case 0:
    //     if (swap.amount0In != 0) {
    //       volume = new BN(swap.amount0In).mul(this.SCALE).div(dec0)
    //     } else {
    //       volume = new BN(swap.amount0Out).mul(this.SCALE).div(dec0)
    //     }
    //     break
    //   case 1:
    //     if (swap.amount0In != 0) {
    //       volume = new BN(swap.amount1Out).mul(this.SCALE).div(dec1)
    //     } else {
    //       volume = new BN(swap.amount1In).mul(this.SCALE).div(dec1)
    //     }
    //     break
    //   default:
    //     break
    // }
    //   sumWeightedPrice = sumWeightedPrice.add(price.mul(volume))
    //   sumVolume = sumVolume.add(volume)
    // }
    // if (sumVolume > new BN('0')) {
    //   let tokenPrice = sumWeightedPrice.div(sumVolume)
    //   return { pair, tokenPrice, sumVolume }
    // }
    // return { pair, tokenPrice: new BN('0'), sumVolume: new BN('0') }
    // }
  }
}
