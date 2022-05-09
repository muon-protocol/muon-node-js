require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { dynamicExtend } = require('../../core/utils')
const Solidly = dynamicExtend(
  class {},
  require('../general/solidly_permissionless_oracles_vwap_v2')
)

const app = new Solidly()

const testLP = async () => {
  let method = 'lp_price'
  return app
    .onRequest({
      method,
      data: {
        params: {
          token: '0xF42dBcf004a93ae6D5922282B304E2aEFDd50058',
          chainId: '250',
          pairs0: [
            {
              exchange: 'solidly',
              chainId: '250',
              address: '0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0' // DEI-USDC
            }
          ],
          pairs1: [
            {
              exchange: 'spirit',
              chainId: '250',
              address: '0xdDC92fcEd95e913728CBc8f197A4E058062Bd4b6' //DEI-DEUS
            },
            {
              exchange: 'solidly',
              chainId: '250',
              address: '0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0' // DEI-USDC
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
          token: '0xDE5ed76E7c05eC5e4572CfC88d1ACEA165109E44',
          pairs: [
            {
              exchange: 'solidly',
              chainId: '250',
              address: '0xF42dBcf004a93ae6D5922282B304E2aEFDd50058' // DEI/DEUS
            },
            {
              exchange: 'spirit',
              chainId: '250',
              address: '0x8eFD36aA4Afa9F4E157bec759F1744A7FeBaEA0e' // DEI/USDC
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
