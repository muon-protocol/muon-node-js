require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { onRequest } = require('../general/nft_oracles_opensea')

const testFp = async () => {
  let method = 'collection_floor_price'
  return onRequest({
    method,
    data: {
      params: {
        collection: '0x11450058d796B02EB53e65374be59cFf65d3FE7f',
        period: 36000
      }
    }
  })
  .then((result) => {
    console.log('\n\nResult for collection_floor_price:')
    console.log(result)
  })
  .catch((error) => console.log(error))
}

const testAp = async () => {
  let method = 'collection_avg_price'
  return onRequest({
    method,
    data: {
      params: {
        collection: '0x11450058d796B02EB53e65374be59cFf65d3FE7f',
        period: 36000
      }
    }
  })
  .then((result) => {
    console.log('\n\nResult for collection_avg_price:')
    console.log(result)
  })
  .catch((error) => console.log(error))
}

testFp()
testAp()