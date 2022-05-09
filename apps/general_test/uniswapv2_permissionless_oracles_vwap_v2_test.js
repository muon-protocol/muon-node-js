require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { dynamicExtend } = require('../../core/utils')
const uniswapApp = dynamicExtend(
  class {},
  require('../general/uniswapv2_permissionless_oracles_vwap_v2')
)

const app = new uniswapApp()

const testLP = async () => {
  let method = 'lp_price'
  return app
    .onRequest({
      method,
      data: {
        params: {
          token: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc',
          chainId: 1,
          pairs0: [],
          pairs1: [
            {
              exchange: 'uniswap',
              chainId: '1',
              address: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'
            }
          ]
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
              exchange: 'uniswap',
              chainId: '1',
              address: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'
            }
          ]
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
