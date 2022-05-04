require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { dynamicExtend } = require('../../core/utils')
const SushiApp = dynamicExtend(
  class {},
  require('../general/sushi_permissionless_oracles_vwap_v2')
)

const app = new SushiApp()

const testLP = async () => {
  let method = 'lp_price'
  return app
    .onRequest({
      method,
      data: {
        params: {
          token: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0',
          pairs0: [],
          pairs1: [
            {
              exchange: 'sushi',
              chainId: 1,
              address: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0'
            }
          ],
          chainId: '1'
        }
      }
    })
    .then(({ tokenPrice, volume }) => {
      console.log('\n \nResult for LP_PRICE:')
      console.log({ tokenPrice, volume })
    })
    .catch((error) => console.log(error))
}

const testPrice = async () => {
  let method = 'price'
  return app
    .onRequest({
      method,
      data: {
        params: {
          token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          pairs: [
            {
              exchange: 'sushi',
              chainId: 1,
              address: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0'
            }
          ],
          chainId: '1'
        }
      }
    })
    .then(({ tokenPrice, volume }) => {
      console.log('\n \nResult for PRICE:')
      console.log({ tokenPrice, volume })
    })
    .catch((error) => console.log(error))
}

testLP()
testPrice()
