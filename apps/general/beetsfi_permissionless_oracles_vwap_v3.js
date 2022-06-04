const { Web3, BigNumber, axios } = MuonAppUtils

const ParentOraclesV3 = require('./parent_oracles_v3')
const {
  GET_POOL_INFO_ABI,
  PAIRS,
  POOL_TOKENS_ABI,
  ERC20_DECIMALS_ABI,
  STABLE,
  WEIGHTED,
  GRAPH_URL,
  GRAPH_DEPLOYMENT_ID
} = require('./parent_oracles.constant.json')

const APP_CONFIG = {
  chainId: 250
}

const getTimestamp = () => Math.floor(Date.now() / 1000)
const bn = (value) => new BigNumber(value)

const ZERO = bn(0)
const ONE = bn(1)
const TWO = bn(2)

// All arguments and return values are 18 decimal fixed point numbers
const ONE_18 = bn('1000000000000000000') // 1e18

// Internally, intermediate values are computed with higher precision as 20 decimal fixed point numbers, and in the case of ln36, 36 decimals
const ONE_20 = bn('100000000000000000000') // 1e20
const ONE_36 = bn('1000000000000000000000000000000000000') // 1e36

// The domain of natural exponentiation is bound by the word size and number of decimals used
// Because internally the result will be stored using 20 decimals, the largest possible result is
// (2^255 - 1) / 10^20, which makes the largest exponent ln((2^255 - 1) / 10^20) = 130.700829182905140221
// The smallest possible result is 10^(-18), which makes largest negative argument
// ln(10^(-18)) = -41.446531673892822312.
// We use 130.0 and -41.0 to have some safety margin
const MAX_NATURAL_EXPONENT = bn('130000000000000000000') // 130e18
const MIN_NATURAL_EXPONENT = bn('-41000000000000000000') // (-41)e18

// Bounds for ln_36's argument
// Both ln(0.9) and ln(1.1) can be represented with 36 decimal places in a fixed point 256 bit integer
const LN_36_LOWER_BOUND = ONE_18.minus(bn('100000000000000000')) // 1e18 - 1e17
const LN_36_UPPER_BOUND = ONE_18.plus(bn('100000000000000000')) // 1e18 + 1e17

const MILD_EXPONENT_BOUND = bn(2).pow(254).idiv(ONE_20)

// 18 decimal constants
const x0 = bn('128000000000000000000') // 2ˆ7
const a0 = bn('38877084059945950922200000000000000000000000000000000000') // eˆ(x0) (no decimals)
const x1 = bn('64000000000000000000') // 2ˆ6
const a1 = bn('6235149080811616882910000000') // eˆ(x1) (no decimals)

// 20 decimal constants
const x2 = bn('3200000000000000000000') // 2ˆ5
const a2 = bn('7896296018268069516100000000000000') // eˆ(x2)
const x3 = bn('1600000000000000000000') // 2ˆ4
const a3 = bn('888611052050787263676000000') // eˆ(x3)
const x4 = bn('800000000000000000000') // 2ˆ3
const a4 = bn('298095798704172827474000') // eˆ(x4)
const x5 = bn('400000000000000000000') // 2ˆ2
const a5 = bn('5459815003314423907810') // eˆ(x5)
const x6 = bn('200000000000000000000') // 2ˆ1
const a6 = bn('738905609893065022723') // eˆ(x6)
const x7 = bn('100000000000000000000') // 2ˆ0
const a7 = bn('271828182845904523536') // eˆ(x7)
const x8 = bn('50000000000000000000') // 2ˆ(-1)
const a8 = bn('164872127070012814685') // eˆ(x8)
const x9 = bn('25000000000000000000') // 2ˆ(-2)
const a9 = bn('128402541668774148407') // eˆ(x9)
const x10 = bn('12500000000000000000') // 2ˆ(-3)
const a10 = bn('113314845306682631683') // eˆ(x10)
const x11 = bn('6250000000000000000') // 2ˆ(-4)
const a11 = bn('106449445891785942956') // eˆ(x11)

const MAX_POW_RELATIVE_ERROR = bn(10000) // 10^(-14)

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
  return a.times(b).idiv(ONE_18)
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

    return product.minus(bn(1)).idiv(ONE_18).plus(bn(1))
  }
}

const fpDivDown = (a, b) => {
  if (b.isZero()) {
    throw new Error('ZERO_DIVISION')
  }
  if (a.isZero()) {
    return a
  } else {
    return a.times(ONE_18).idiv(b)
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

    return a.times(ONE_18).minus(bn(1)).idiv(b).plus(bn(1))
  }
}

const logExpPow = (x, y) => {
  if (y.isZero()) {
    // We solve the 0^0 indetermination by making it equal one.
    return ONE_18
  }

  if (x.isZero()) {
    return bn(0)
  }

  // Instead of computing x^y directly, we instead rely on the properties of logarithms and exponentiation to
  // arrive at that result. In particular, exp(ln(x)) = x, and ln(x^y) = y * ln(x). This means
  // x^y = exp(y * ln(x)).

  // The ln function takes a signed value, so we need to make sure x fits in the signed 256 bit range.
  if (x.gte(bn(2).pow(255))) {
    throw new Error('X_OUT_OF_BOUNDS')
  }

  // We will compute y * ln(x) in a single step. Depending on the value of x, we can either use ln or ln_36. In
  // both cases, we leave the division by ONE_18 (due to fixed point multiplication) to the end.

  // This prevents y * ln(x) from overflowing, and at the same time guarantees y fits in the signed 256 bit range.
  if (y.gte(MILD_EXPONENT_BOUND)) {
    throw new Error('Y_OUT_OF_BOUNDS')
  }

  let logx_times_y
  if (LN_36_LOWER_BOUND.lt(x) && x.lt(LN_36_UPPER_BOUND)) {
    let ln_36_x = _ln_36(x)

    // ln_36_x has 36 decimal places, so multiplying by y_int256 isn't as straightforward, since we can't just
    // bring y_int256 to 36 decimal places, as it might overflow. Instead, we perform two 18 decimal
    // multiplications and add the results: one with the first 18 decimals of ln_36_x, and one with the
    // (downscaled) last 18 decimals.
    logx_times_y = ln_36_x
      .idiv(ONE_18)
      .times(y)
      .plus(ln_36_x.mod(ONE_18).times(y).idiv(ONE_18))
  } else {
    logx_times_y = _ln(x).times(y)
  }
  logx_times_y = logx_times_y.idiv(ONE_18)

  // Finally, we compute exp(y * ln(x)) to arrive at x^y
  if (
    logx_times_y.lt(MIN_NATURAL_EXPONENT) ||
    logx_times_y.gt(MAX_NATURAL_EXPONENT)
  ) {
    throw new Error('PRODUCT_OUT_OF_BOUNDS')
  }

  return exp(logx_times_y)
}

const exp = (x) => {
  if (x.lt(MIN_NATURAL_EXPONENT) || x.gt(MAX_NATURAL_EXPONENT)) {
    throw new Error('INVALID_EXPONENT')
  }

  if (x.lt(0)) {
    // We only handle positive exponents: e^(-x) is computed as 1 / e^x. We can safely make x positive since it
    // fits in the signed 256 bit range (as it is larger than MIN_NATURAL_EXPONENT).
    // Fixed point division requires multiplying by ONE_18.
    return ONE_18.times(ONE_18).idiv(exp(x.negated()))
  }

  // First, we use the fact that e^(x+y) = e^x * e^y to decompose x into a sum of powers of two, which we call x_n,
  // where x_n == 2^(7 - n), and e^x_n = a_n has been precomputed. We choose the first x_n, x0, to equal 2^7
  // because all larger powers are larger than MAX_NATURAL_EXPONENT, and therefore not present in the
  // decomposition.
  // At the end of this process we will have the product of all e^x_n = a_n that apply, and the remainder of this
  // decomposition, which will be lower than the smallest x_n.
  // exp(x) = k_0 * a_0 * k_1 * a_1 * ... + k_n * a_n * exp(remainder), where each k_n equals either 0 or 1.
  // We mutate x by subtracting x_n, making it the remainder of the decomposition.

  // The first two a_n (e^(2^7) and e^(2^6)) are too large if stored as 18 decimal numbers, and could cause
  // intermediate overflows. Instead we store them as plain integers, with 0 decimals.
  // Additionally, x0 + x1 is larger than MAX_NATURAL_EXPONENT, which means they will not both be present in the
  // decomposition.

  // For each x_n, we test if that term is present in the decomposition (if x is larger than it), and if so deduct
  // it and compute the accumulated product.

  let firstAN
  if (x.gte(x0)) {
    x = x.minus(x0)
    firstAN = a0
  } else if (x.gte(x1)) {
    x = x.minus(x1)
    firstAN = a1
  } else {
    firstAN = bn(1) // One with no decimal places
  }

  // We now transform x into a 20 decimal fixed point number, to have enhanced precision when computing the
  // smaller terms.
  x = x.times(100)

  // `product` is the accumulated product of all a_n (except a0 and a1), which starts at 20 decimal fixed point
  // one. Recall that fixed point multiplication requires dividing by ONE_20.
  let product = ONE_20

  if (x.gte(x2)) {
    x = x.minus(x2)
    product = product.times(a2).idiv(ONE_20)
  }
  if (x.gte(x3)) {
    x = x.minus(x3)
    product = product.times(a3).idiv(ONE_20)
  }
  if (x.gte(x4)) {
    x = x.minus(x4)
    product = product.times(a4).idiv(ONE_20)
  }
  if (x.gte(x5)) {
    x = x.minus(x5)
    product = product.times(a5).idiv(ONE_20)
  }
  if (x.gte(x6)) {
    x = x.minus(x6)
    product = product.times(a6).idiv(ONE_20)
  }
  if (x.gte(x7)) {
    x = x.minus(x7)
    product = product.times(a7).idiv(ONE_20)
  }
  if (x.gte(x8)) {
    x = x.minus(x8)
    product = product.times(a8).idiv(ONE_20)
  }
  if (x.gte(x9)) {
    x = x.minus(x9)
    product = product.times(a9).idiv(ONE_20)
  }

  // x10 and x11 are unnecessary here since we have high enough precision already.

  // Now we need to compute e^x, where x is small (in particular, it is smaller than x9). We use the Taylor series
  // expansion for e^x: 1 + x + (x^2 / 2!) + (x^3 / 3!) + ... + (x^n / n!).

  let seriesSum = ONE_20 // The initial one in the sum, with 20 decimal places.
  let term // Each term in the sum, where the nth term is (x^n / n!).

  // The first term is simply x.
  term = x
  seriesSum = seriesSum.plus(term)

  // Each term (x^n / n!) equals the previous one times x, divided by n. Since x is a fixed point number,
  // multiplying by it requires dividing by ONE_20, but dividing by the non-fixed point n values does not.

  term = term.times(x).idiv(ONE_20).idiv(2)
  seriesSum = seriesSum.plus(term)

  term = term.times(x).idiv(ONE_20).idiv(3)
  seriesSum = seriesSum.plus(term)

  term = term.times(x).idiv(ONE_20).idiv(4)
  seriesSum = seriesSum.plus(term)

  term = term.times(x).idiv(ONE_20).idiv(5)
  seriesSum = seriesSum.plus(term)

  term = term.times(x).idiv(ONE_20).idiv(6)
  seriesSum = seriesSum.plus(term)

  term = term.times(x).idiv(ONE_20).idiv(7)
  seriesSum = seriesSum.plus(term)

  term = term.times(x).idiv(ONE_20).idiv(8)
  seriesSum = seriesSum.plus(term)

  term = term.times(x).idiv(ONE_20).idiv(9)
  seriesSum = seriesSum.plus(term)

  term = term.times(x).idiv(ONE_20).idiv(10)
  seriesSum = seriesSum.plus(term)

  term = term.times(x).idiv(ONE_20).idiv(11)
  seriesSum = seriesSum.plus(term)

  term = term.times(x).idiv(ONE_20).idiv(12)
  seriesSum = seriesSum.plus(term)

  // 12 Taylor terms are sufficient for 18 decimal precision.

  // We now have the first a_n (with no decimals), and the product of all other a_n present, and the Taylor
  // approximation of the exponentiation of the remainder (both with 20 decimals). All that remains is to multiply
  // all three (one 20 decimal fixed point multiplication, dividing by ONE_20, and one integer multiplication),
  // and then drop two digits to return an 18 decimal value.

  return product.times(seriesSum).idiv(ONE_20).times(firstAN).idiv(100)
}

const _ln = (a) => {
  if (a.lt(ONE_18)) {
    // Since ln(a^k) = k * ln(a), we can compute ln(a) as ln(a) = ln((1/a)^(-1)) = - ln((1/a))
    // If a is less than one, 1/a will be greater than one, and this if statement will not be entered in the recursive call
    // Fixed point division requires multiplying by ONE_18
    return _ln(ONE_18.times(ONE_18).idiv(a)).negated()
  }

  // First, we use the fact that ln^(a * b) = ln(a) + ln(b) to decompose ln(a) into a sum of powers of two, which
  // we call x_n, where x_n == 2^(7 - n), which are the natural logarithm of precomputed quantities a_n (that is,
  // ln(a_n) = x_n). We choose the first x_n, x0, to equal 2^7 because the exponential of all larger powers cannot
  // be represented as 18 fixed point decimal numbers in 256 bits, and are therefore larger than a.
  // At the end of this process we will have the sum of all x_n = ln(a_n) that apply, and the remainder of this
  // decomposition, which will be lower than the smallest a_n.
  // ln(a) = k_0 * x_0 + k_1 * x_1 + ... + k_n * x_n + ln(remainder), where each k_n equals either 0 or 1
  // We mutate a by subtracting a_n, making it the remainder of the decomposition

  // For reasons related to how `exp` works, the first two a_n (e^(2^7) and e^(2^6)) are not stored as fixed point
  // numbers with 18 decimals, but instead as plain integers with 0 decimals, so we need to multiply them by
  // ONE_18 to convert them to fixed point.
  // For each a_n, we test if that term is present in the decomposition (if a is larger than it), and if so divide
  // by it and compute the accumulated sum.

  let sum = bn(0)
  if (a.gte(a0.times(ONE_18))) {
    a = a.idiv(a0) // Integer, not fixed point division
    sum = sum.plus(x0)
  }

  if (a.gte(a1.times(ONE_18))) {
    a = a.idiv(a1) // Integer, not fixed point division
    sum = sum.plus(x1)
  }

  // All other a_n and x_n are stored as 20 digit fixed point numbers, so we convert the sum and a to this format.
  sum = sum.times(100)
  a = a.times(100)

  // Because further a_n are  20 digit fixed point numbers, we multiply by ONE_20 when dividing by them.

  if (a.gte(a2)) {
    a = a.times(ONE_20).idiv(a2)
    sum = sum.plus(x2)
  }

  if (a.gte(a3)) {
    a = a.times(ONE_20).idiv(a3)
    sum = sum.plus(x3)
  }

  if (a.gte(a4)) {
    a = a.times(ONE_20).idiv(a4)
    sum = sum.plus(x4)
  }

  if (a.gte(a5)) {
    a = a.times(ONE_20).idiv(a5)
    sum = sum.plus(x5)
  }

  if (a.gte(a6)) {
    a = a.times(ONE_20).idiv(a6)
    sum = sum.plus(x6)
  }

  if (a.gte(a7)) {
    a = a.times(ONE_20).idiv(a7)
    sum = sum.plus(x7)
  }

  if (a.gte(a8)) {
    a = a.times(ONE_20).idiv(a8)
    sum = sum.plus(x8)
  }

  if (a.gte(a9)) {
    a = a.times(ONE_20).idiv(a9)
    sum = sum.plus(x9)
  }

  if (a.gte(a10)) {
    a = a.times(ONE_20).idiv(a10)
    sum = sum.plus(x10)
  }

  if (a.gte(a11)) {
    a = a.times(ONE_20).idiv(a11)
    sum = sum.plus(x11)
  }

  // a is now a small number (smaller than a_11, which roughly equals 1.06). This means we can use a Taylor series
  // that converges rapidly for values of `a` close to one - the same one used in ln_36.
  // Let z = (a - 1) / (a + 1).
  // ln(a) = 2 * (z + z^3 / 3 + z^5 / 5 + z^7 / 7 + ... + z^(2 * n + 1) / (2 * n + 1))

  // Recall that 20 digit fixed point division requires multiplying by ONE_20, and multiplication requires
  // division by ONE_20.
  const z = a.minus(ONE_20).times(ONE_20).idiv(a.plus(ONE_20))
  const z_squared = z.times(z).idiv(ONE_20)

  // num is the numerator of the series: the z^(2 * n + 1) term
  let num = z

  // seriesSum holds the accumulated sum of each term in the series, starting with the initial z
  let seriesSum = num

  // In each step, the numerator is multiplied by z^2
  num = num.times(z_squared).idiv(ONE_20)
  seriesSum = seriesSum.plus(num.idiv(3))

  num = num.times(z_squared).idiv(ONE_20)
  seriesSum = seriesSum.plus(num.idiv(5))

  num = num.times(z_squared).idiv(ONE_20)
  seriesSum = seriesSum.plus(num.idiv(7))

  num = num.times(z_squared).idiv(ONE_20)
  seriesSum = seriesSum.plus(num.idiv(9))

  num = num.times(z_squared).idiv(ONE_20)
  seriesSum = seriesSum.plus(num.idiv(11))

  // 6 Taylor terms are sufficient for 36 decimal precision.

  // Finally, we multiply by 2 (non fixed point) to compute ln(remainder)
  seriesSum = seriesSum.times(2)

  // We now have the sum of all x_n present, and the Taylor approximation of the logarithm of the remainder (both
  // with 20 decimals). All that remains is to sum these two, and then drop two digits to return a 18 decimal
  // value.

  return sum.plus(seriesSum).idiv(100)
}

const _ln_36 = (x) => {
  // Since ln(1) = 0, a value of x close to one will yield a very small result, which makes using 36 digits worthwhile

  // First, we transform x to a 36 digit fixed point value
  x = x.times(ONE_18)

  // We will use the following Taylor expansion, which converges very rapidly. Let z = (x - 1) / (x + 1)
  // ln(x) = 2 * (z + z^3 / 3 + z^5 / 5 + z^7 / 7 + ... + z^(2 * n + 1) / (2 * n + 1))

  // Recall that 36 digit fixed point division requires multiplying by ONE_36, and multiplication requires division by ONE_36
  const z = x.minus(ONE_36).times(ONE_36).idiv(x.plus(ONE_36))
  const z_squared = z.times(z).idiv(ONE_36)

  // num is the numerator of the series: the z^(2 * n + 1) term
  let num = z

  // seriesSum holds the accumulated sum of each term in the series, starting with the initial z
  let seriesSum = num

  // In each step, the numerator is multiplied by z^2
  num = num.times(z_squared).idiv(ONE_36)
  seriesSum = seriesSum.plus(num.idiv(3))

  num = num.times(z_squared).idiv(ONE_36)
  seriesSum = seriesSum.plus(num.idiv(5))

  num = num.times(z_squared).idiv(ONE_36)
  seriesSum = seriesSum.plus(num.idiv(7))

  num = num.times(z_squared).idiv(ONE_36)
  seriesSum = seriesSum.plus(num.idiv(9))

  num = num.times(z_squared).idiv(ONE_36)
  seriesSum = seriesSum.plus(num.idiv(11))

  num = num.times(z_squared).idiv(ONE_36)
  seriesSum = seriesSum.plus(num.idiv(13))

  num = num.times(z_squared).idiv(ONE_36)
  seriesSum = seriesSum.plus(num.idiv(15))

  // 8 Taylor terms are sufficient for 36 decimal precision

  // All that remains is multiplying by 2 (non fixed point)
  return seriesSum.times(2)
}
const fpPowUp = (x, y) => {
  const raw = logExpPow(x, y)
  const maxError = fpMulUp(raw, MAX_POW_RELATIVE_ERROR).plus(bn(1))
  return raw.plus(maxError)
}

const fpComplement = (x) => {
  return x.lt(ONE_18) ? ONE_18.minus(x) : ZERO
}

module.exports = {
  ...ParentOraclesV3,

  APP_NAME: 'beetsfi_permissionless_oracles_vwap_v3',
  APP_ID: 32,
  config: APP_CONFIG,

  getTokenTxs: async function (poolId, graphUrl, deploymentID, start, end) {
    const currentTimestamp = getTimestamp()
    const timestamp_lt = end ? end : currentTimestamp
    const timestamp_gt = start ? start : currentTimestamp - 1800
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
                  poolId: "${poolId.toLowerCase()}"
                },
                orderBy: timestamp,
                orderDirection: desc
              ) {
                poolId
                tokenIn{
                  id
                  name
                }
                tokenOut{
                  id
                  name
                }
                tokenAmountIn
                tokenAmountOut
                poolTokenBalances
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
                    poolId: "${poolId.toLowerCase()}",
                    timestamp_gt: ${timestamp_gt},
                    timestamp_lt: ${timestamp_lt}
                  },
                  orderBy: timestamp,
                  orderDirection: desc
                ) {
                  poolId
                  tokenIn{
                    id
                    name
                  }
                  tokenOut{
                    id
                    name
                  }
                  tokenAmountIn
                  tokenAmountOut
                  poolTokenBalances
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
        throw { message: `SUBGRAPH_QUERY_FAILED:${error.message}` }
      }
    }
    return tokenTxs
  },

  upScale: function (amount, decimals) {
    return bn(amount).times(this.SCALE).div(decimals)
  },

  upScale2: function (amount, decimals) {
    return bn(amount).times(this.SCALE)
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
          param = { weight: item.weight }
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
          poolId: item.poolId,
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
          param = { weight: item.context.weight }
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
        poolId: item.context.poolId,
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
      const decimals = item.tokens.map((token) => {
        const info = this.getInfoContract(resultDecimals, prefix + '_' + token)
        const decimals = info[0].callsReturnContext[0].returnValues[0]
        return bn(10).pow(bn(decimals)).toString()
      })
      const tokensInfo = item.tokens.map((token, index) => {
        const weight =
          item.pool === WEIGHTED ? { weight: item.weight[index] } : {}
        return {
          token,
          index: index,
          decimals: decimals[index],
          balance: item.balances[index],
          ...weight
        }
      })
      return {
        ...item,
        decimals,
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
          const weight = this.getReturnValue(
            item.callsReturnContext,
            'getNormalizedWeights'
          )
          param = { weight }

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
    let pairTokenIn = token
    let pairTokenOut = token
    let destToken = '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75' // USDC
    return pairs.map((pair) => {
      let currentMetadata = metadata.find(
        (item) =>
          item.reference === PAIRS + '_' + pair.exchange + ':' + pair.address
      )
      pairTokenIn = currentMetadata.tokens.find((item) =>
        [pairTokenOut.toLowerCase()].includes(item.toLowerCase())
      )
      pairTokenOut = currentMetadata.tokens.filter(
        (item) => item.toLowerCase() !== pairTokenIn.toLowerCase()
      )
      let filterDestToken = pairTokenOut.find(
        (item) => item.toLowerCase() === destToken.toLowerCase()
      )
      pairTokenOut = filterDestToken ? filterDestToken : pairTokenOut[0]
      return this.pairVWAP(
        token,
        pairTokenIn,
        pairTokenOut,
        currentMetadata.poolId,
        pair.exchange,
        pair.chainId,
        currentMetadata,
        start,
        end
      )
    })
  },

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
    amountIn,
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
      amountIn,
      invariant
    )
    const price = amountOut.div(amountIn)
    return price
  },

  tokenPriceWeighted: function (
    balanceIn,
    weightIn,
    balanceOut,
    weightOut,
    amountIn
  ) {
    /*****************************************************************************************
    // outGivenIn                                                                           //
    // ao = amountOut                                                                       //
    // bo = balanceOut                                                                      //
    // bi = balanceIn              /      /            bi             \    (wi / wo) \      //
    // ai = amountIn    ao = bo * |  1 - | --------------------------  | ^            |     //
    // wi = weightIn               \      \       ( bi + ai )         /              /      //
    // wo = weightOut                                                                       //
    *****************************************************************************************/

    // console.log({
    //   bI: balanceIn.toString(),
    //   wi: weightIn.toString(),
    //   bo: balanceOut.toString(),
    //   wo: weightOut.toString(),
    //   amountIn: amountIn.toString()
    // })
    const denominator = balanceIn.plus(amountIn)
    const base = fpDivUp(balanceIn, denominator)
    const exponent = fpDivDown(weightIn, weightOut)
    const power = fpPowUp(base, exponent)
    const amountOut = fpMulDown(balanceOut, fpComplement(power))
    return amountOut.div(amountIn)
  },

  pairVWAP: async function (
    token,
    pairTokenIn,
    pairTokenOut,
    poolId,
    exchange,
    chainId,
    metadata,
    start,
    end
  ) {
    // console.log({ token, pairTokenIn, pairTokenOut, poolId })
    // TODO based on subgraph prepare this fun
    const tokenTxs = await this.getTokenTxs(
      poolId,
      GRAPH_URL[exchange],
      GRAPH_DEPLOYMENT_ID[exchange],
      start,
      end
    )
    if (tokenTxs) {
      let sumWeightedPrice = ZERO
      let sumWeightedP = ZERO

      let sumVolume = ZERO
      for (let i = 0; i < tokenTxs.length; i++) {
        let swap = tokenTxs[i]

        // TODO to be sure this condition is enough and if it's true combine with next condition

        if (!swap.tokenAmountIn || !swap.tokenAmountOut) {
          continue
        }
        // console.log('*********************************', swap.tokenIn)
        if (
          ![pairTokenIn.toLowerCase(), pairTokenOut.toLowerCase()].includes(
            swap.tokenIn.id.toLowerCase()
          ) ||
          ![pairTokenIn.toLowerCase(), pairTokenOut.toLowerCase()].includes(
            swap.tokenOut.id.toLowerCase()
          )
        ) {
          continue
        }
        const tokenIn = metadata.tokensInfo.find(
          (item) => item.token.toLowerCase() === swap.tokenIn.id.toLowerCase()
        )
        const tokenOut = metadata.tokensInfo.find(
          (item) => item.token.toLowerCase() === swap.tokenOut.id.toLowerCase()
        )
        const exchange =
          swap.tokenIn.id.toLowerCase() !== pairTokenIn.toLowerCase()
        let price = ZERO
        let p = ZERO
        let volume = ZERO
        const poolTokenBalances = swap.poolTokenBalances.map((item, index) =>
          this.upScale(item, metadata.decimals[index])
        )
        switch (metadata.pool) {
          case STABLE:
            price = this.tokenPriceStable(
              metadata.ampValue,
              metadata.ampPrecision,
              exchange
                ? this.upScale2(swap.tokenAmountOut, tokenOut.decimals)
                : this.upScale2(swap.tokenAmountIn, tokenIn.decimals),
              [...poolTokenBalances],
              exchange ? tokenOut.index : tokenIn.index,
              exchange ? tokenIn.index : tokenOut.index
            )
            p = exchange
              ? this.upScale2(swap.tokenAmountIn, tokenIn.decimals).div(
                  this.upScale2(swap.tokenAmountOut, tokenOut.decimals)
                )
              : this.upScale2(swap.tokenAmountOut, tokenOut.decimals).div(
                  this.upScale2(swap.tokenAmountIn, tokenIn.decimals)
                )
            break
          case WEIGHTED:
            //  TODO double check to be sure about weighted decimal

            price = this.tokenPriceWeighted(
              exchange
                ? poolTokenBalances[tokenOut.index]
                : poolTokenBalances[tokenIn.index],
              exchange
                ? this.upScale(tokenOut.weight, this.SCALE)
                : this.upScale(tokenIn.weight, this.SCALE),
              exchange
                ? poolTokenBalances[tokenIn.index]
                : poolTokenBalances[tokenOut.index],
              exchange
                ? this.upScale(tokenIn.weight, this.SCALE)
                : this.upScale(tokenOut.weight, this.SCALE),
              exchange
                ? this.upScale2(swap.tokenAmountOut, tokenOut.decimals)
                : this.upScale2(swap.tokenAmountIn, tokenIn.decimals)
            )
            p = exchange
              ? this.upScale2(swap.tokenAmountIn, tokenIn.decimals).div(
                  this.upScale2(swap.tokenAmountOut, tokenOut.decimals)
                )
              : this.upScale2(swap.tokenAmountOut, tokenOut.decimals).div(
                  this.upScale2(swap.tokenAmountIn, tokenIn.decimals)
                )
            // console.log(swap)
            // console.log('price by formula', price.toString())
            // console.log('price by amount', p.toString())
            break

          default:
            break
        }

        // console.log({ price: price.toString() })
        // TODO to be sure these condition are true
        switch (pairTokenIn.toLowerCase()) {
          case swap.tokenIn.id.toLowerCase():
            volume = this.upScale(swap.tokenAmountIn, tokenIn.decimals)
            break

          case swap.tokenOut.id.toLowerCase():
            volume = this.upScale(swap.tokenAmountOut, tokenOut.decimals)
            break

          default:
            throw new Error('INVALID TOKEN BASED ON SWAP')
        }
        sumWeightedPrice = sumWeightedPrice.plus(price.times(volume))

        sumWeightedP = sumWeightedP.plus(p.times(volume))

        sumVolume = sumVolume.plus(volume)
      }
      // console.log('sumWeightedPrice by formula', sumWeightedPrice.toString())
      // console.log('sumWeightedPrice by amount', sumWeightedP.toString())

      if (sumVolume > ZERO) {
        let tokenPrice = sumWeightedPrice.div(sumVolume)
        let tokenP = sumWeightedP.div(sumVolume)
        // console.log('price by formula', tokenPrice.toString())
        // console.log('price by amount', tokenP.toString())
        // console.log('sum volume', sumVolume.toString())
        return {
          tokenPrice: this.upScale2(tokenPrice),
          sumVolume,
          tokenP: this.upScale2(tokenP)
        }
      }
      return { tokenPrice: ZERO, sumVolume: ZERO }
    }
  },

  calculatePriceToken: function (pairVWAPs, pairs) {
    let volume = pairVWAPs.reduce((previousValue, currentValue) => {
      return previousValue.plus(currentValue.sumVolume)
    }, ZERO)
    let price = pairVWAPs.reduce((price, currentValue) => {
      return price.times(currentValue.tokenPrice).div(this.SCALE)
    }, bn(this.SCALE))
    let p = pairVWAPs.reduce((price, currentValue) => {
      return price.times(currentValue.tokenP).div(this.SCALE)
    }, bn(this.SCALE))

    if (volume.toString() == '0' || price.toString() == '0') {
      throw { message: 'INVALID_PRICE' }
    }
    return { p: p.div(this.SCALE), price: price.div(this.SCALE), volume }
  }
}
