require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { dynamicExtend } = require('../../core/utils')
const SpookyApp = dynamicExtend(
  class {},
  require('../general/spooky_permissionless_oracles_vwap_v2')
)

const app = new SpookyApp()

const testLP = async () => {
  let method = 'lp_price'
  return app
    .onRequest({
      method,
      data: {
        params: {
          token: '0x2b4C76d0dc16BE1C31D4C1DC53bF9B45987Fc75c',
          chainId: 250,
          pairs0: [],
          pairs1: [
            {
              exchange: 'spooky',
              chainId: '250',
              address: '0x2b4C76d0dc16BE1C31D4C1DC53bF9B45987Fc75c'
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
          token: '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83',
          pairs: [
            {
              exchange: 'spooky',
              chainId: '250',
              address: '0x2b4C76d0dc16BE1C31D4C1DC53bF9B45987Fc75c'
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
