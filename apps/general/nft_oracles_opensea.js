const { axios, toBaseUnit, soliditySha3, BN } = MuonAppUtils

const getTimestamp = () => Math.floor(Date.now() / 1000)
const SCALE = new BN('1000000000000000000')
const GRAPH_URL =
  'https://api.thegraph.com/subgraphs/name/kowsaratz/nfts-price-v1-test'
const GRAPH_DEPLOYMENT_ID = 'QmVHBkatRPaafxR1Rxi3kjMZobAEbbuDnWaMRgTyu8HHcc'
const PRICE_TOLERANCE = '0.05'
const ETH_ID = "0x0000000000000000000000000000000000000000";
const WETH_ID = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

async function getSaleTxs(collection, 
  graphUrl, deploymentID, period) {
  let currentTimestamp = getTimestamp()
  let periodCond = ""
  if(period)
  {
    periodCond = "timestamp_gt: " + (currentTimestamp - period)
  }
  let skip = 0
  let saleTxs = []
  let queryIndex = 0
  while (true) {
    queryIndex += 1
    let lastRowQuery =
      queryIndex === 1
        ? `
      sales_last_rows:sales(
        first: 1,
        where: {
          collection: "${collection.toLowerCase()}",
          paymentToken_in: [
            "${ETH_ID}",
            "${WETH_ID}"
          ]
        },
        orderBy: timestamp,
        orderDirection: desc
      ) {
        usdtPrice
        tokenId
        timestamp
      }
    `
        : ''
    const query = `
      {
        sales(
          first: 1000,
          skip: ${skip},
          where: {
            collection: "${collection.toLowerCase()}",
            ${periodCond},
            timestamp_lt: ${currentTimestamp},
            paymentToken_in: [
              "${ETH_ID}",
              "${WETH_ID}"
            ]
          },
          orderBy: timestamp,
          orderDirection: desc
        ) {
          usdtPrice
          tokenId
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
          sales,
          _meta: { deployment }
        } = data
        if (deployment != deploymentID) {
          throw { message: 'SUBGRAPH_IS_UPDATED' }
        }
        if (!sales.length) {
          if (queryIndex === 1) {
            saleTxs = saleTxs.concat(data.sales_last_rows)
          }
          break
        }
        saleTxs = saleTxs.concat(sales)
        if (skip > 5000) {
          currentTimestamp = sales[sales.length - 1]['timestamp']
          skip = 0
        }
      } else {
        throw { message: 'INVALID_SUBGRAPH_RESPONSE' }
      }
    } catch (error) {
      throw { 
        message: `SUBGRAPH_QUERY_FAILED: ${error.message}` 
      }
    }
  }
  return saleTxs
}

async function collectionFloorPrice(collection, period) {
  return getSaleTxs(
    collection, 
    GRAPH_URL, 
    GRAPH_DEPLOYMENT_ID, 
    period
  ).then((saleTxs) => {
    if(!saleTxs.length)
    {
      throw { message: "INVALID_SALES_LENGTH" }
    }
    return saleTxs.reduce((floorPrice, tx) => {
      const priceDecimal = new BN('1000000')
      let salePrice = new BN(tx.usdtPrice)
      let price = salePrice.mul(SCALE).div(priceDecimal)
      if(!floorPrice || price.lt(floorPrice))
      {
        floorPrice = price
      }
      return floorPrice
    }, undefined)
  })
}

async function collectionAvgPrice(collection, period) {
  return getSaleTxs(
    collection, 
    GRAPH_URL, 
    GRAPH_DEPLOYMENT_ID, 
    period
  ).then((saleTxs) => {
    if(!saleTxs.length)
    {
      throw { message: "INVALID_SALES_LENGTH" }
    }
    let sumPrice = saleTxs.reduce((sum, tx) => {
      const priceDecimal = new BN('1000000')
      let salePrice = new BN(tx.usdtPrice)
      let price = salePrice.mul(SCALE).div(priceDecimal)
      return sum.add(price)
    }, new BN(0))
    return sumPrice.div(new BN(saleTxs.length))
  })
}

module.exports = {
  APP_NAME: 'nft_oracles_opensea',
  APP_ID: 24,
  REMOTE_CALL_TIMEOUT: 30000,

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request

    switch (method) {
      case 'collection_floor_price':
        let { collection, period, hashTimestamp } = params
        if(period < 0)
        {
          throw { message: "INVALID_PERIOD" }
        }
        let floorPrice = await collectionFloorPrice(collection, period)
        return {
          collection: collection,
          period: period,
          price: floorPrice.toString(),
          ...(hashTimestamp ? { timestamp: request.data.timestamp } : {})
        }
      case 'collection_avg_price': {
        let { collection, period, hashTimestamp } = params
        if(period < 0)
        {
          throw { message: "INVALID_PERIOD" }
        }
        let avgPrice = await collectionAvgPrice(collection, period)
        return {
          collection: collection,
          period: period,
          price: avgPrice.toString(),
          ...(hashTimestamp ? { timestamp: request.data.timestamp } : {})
        }
      }

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  isPriceToleranceOk: function (price, expectedPrice) {
    let priceDiff = new BN(price).sub(new BN(expectedPrice)).abs()

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
    let {
      method,
      data: { params }
    } = request
    let { hashTimestamp } = params
    switch (method) {
      case 'collection_floor_price': {
        if (
          !this.isPriceToleranceOk(
            result.price,
            request.data.result.price
          )
        ) {
          throw { message: 'Price threshold exceeded' }
        }
        let { collection, period } = result

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: collection },
          { type: 'uint32', value: period },
          { type: 'uint256', value: request.data.result.price },

          ...(hashTimestamp
            ? [{ type: 'uint256', value: request.data.timestamp }]
            : [])
        ])
      }
      case 'collection_avg_price': {
        if (
          !this.isPriceToleranceOk(
            result.price,
            request.data.result.price
          )
        ) {
          throw { message: 'Price threshold exceeded' }
        }
        let { collection, period } = result

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: collection },
          { type: 'uint32', value: period },
          { type: 'uint256', value: request.data.result.price },

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
