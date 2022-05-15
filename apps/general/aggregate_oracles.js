const { axios, toBaseUnit, soliditySha3, BN, multiCall, flatten, groupBy } =
  MuonAppUtils
const SpriteVWAP = require('./spirit_permissionless_oracles_vwap_v2')
const {
  Info_ABI,
  STABLE_EXCHANGES
} = require('./spirit_permissionless_oracles_vwap_v2.constant.json')
const APP_CONFIG = {
  chainId: 250
}

module.exports = {
  ...SpriteVWAP,

  APP_NAME: 'aggregate_oracles',
  APP_ID: 30,
  config: APP_CONFIG,

  makeCallContextInfo: function (pairs, prefix) {
    let calls = []
    let pairCache = []

    pairs.forEach((pair, index) => {
      pair.forEach((item) => {
        if (!pairCache.includes(item.address)) {
          pairCache.push(item.address)
          const stableCall = STABLE_EXCHANGES.includes(item.exchange)
            ? [
                {
                  reference: prefix + ':' + item.address,
                  methodName: 'stable'
                }
              ]
            : []
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
              },
              ...stableCall
            ],
            context: {
              // pairIndex: index,
              pair: item.address,
              exchange: item.exchange,
              chainId: item.chainId
            }
          })
        }
      })
    })
    return calls
  },

  preparePromisePair: function (token, pairs, metadata, start, end) {
    return pairs.map((info) => {
      let inputToken = token
      return this.makePromisePair(inputToken, info, metadata, start, end)
    })
  },

  calculatePriceToken: function (pairVWAPs, pairs) {
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
        return price.mul(result.tokenPrice).div(this.SCALE)
      }, new BN(this.SCALE))
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
}
