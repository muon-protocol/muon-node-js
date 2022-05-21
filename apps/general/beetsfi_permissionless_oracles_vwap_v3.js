const { Web3, BN } = MuonAppUtils

const SpriteVWAP = require('./spirit_permissionless_oracles_vwap_v3')
const {
  GET_POOL_INFO_ABI,
  PAIRS,
  POOL_TOKENS_ABI,
  ERC20_DECIMALS_ABI
} = require('./spirit_permissionless_oracles_vwap_v2.constant.json')
const { async } = require('regenerator-runtime')
const APP_CONFIG = {
  chainId: 250
}

module.exports = {
  ...SpriteVWAP,

  APP_NAME: 'beetsfi_permissionless_oracles_vwap_v3',
  APP_ID: 32,
  config: APP_CONFIG,

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
        reference: prefix + '_' + item.exchange + ':' + item.poolId,
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

  pairVWAP: async function (
    token,
    pair,
    exchange,
    chainId,
    metadata,
    start,
    end
  ) {
    // TODO based on subgraph prepare this fun
    const tokenTxs = await this.prepareTokenTx(
      pair,
      exchange,
      chainId,
      start,
      end
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
        // let dec0 = new BN(metadata.dec0)
        // let dec1 = new BN(metadata.dec1)
        let reserve0 = new BN(swap.reserve0).mul(this.SCALE).div(dec0)
        let reserve1 = new BN(swap.reserve1).mul(this.SCALE).div(dec1)
        let price = this.tokenPrice(metadata.stable, index, reserve0, reserve1)
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
}
