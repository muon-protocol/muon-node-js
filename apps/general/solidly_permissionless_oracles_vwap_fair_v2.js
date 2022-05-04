const { BN, BNSqrt } = MuonAppUtils

const Solidly = require('./solidly_permissionless_oracles_vwap_v2')

module.exports = {
  ...Solidly,

  APP_NAME: 'solidly_permissionless_oracles_vwap_fair_v2',
  APP_ID: 27,

  calculatePrice: function (
    reserveA,
    reserveB,
    pairs0,
    pairs1,
    _tokenVWAPResults,
    totalSupply
  ) {
    let sumVolume = new BN('0')

    let priceA, priceB
    priceA = priceB = new BN(this.SCALE)

    if (pairs0.length) {
      const { price, volume } = _tokenVWAPResults[0]
      sumVolume = sumVolume.add(volume)
      priceA = price
    }

    if (pairs1.length) {
      const { price, volume } = _tokenVWAPResults[1]
      sumVolume = sumVolume.add(volume)
      priceB = price
    }

    let sqrtK = BNSqrt(reserveA.mul(reserveB))
    let sqrtP = BNSqrt(priceA.mul(priceB))
    const fairPrice = sqrtK.mul(sqrtP).mul(new BN('2')).div(totalSupply)

    return { price: fairPrice, sumVolume }
  }
}
