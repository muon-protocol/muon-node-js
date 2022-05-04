require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { dynamicExtend } = require('../../core/utils')
const SpiritApp = dynamicExtend(
  class {},
  require('../general/spirit_permissionless_oracles_vwap')
)

const app = new SpiritApp()

const testLP = async () => {
  let method = 'lp_price'
  return app
    .onRequest({
      method,
      data: {
        params: {
          token: '0xe7E90f5a767406efF87Fdad7EB07ef407922EC1D',
          pairs0: '',
          pairs1: '0xe7E90f5a767406efF87Fdad7EB07ef407922EC1D'
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
          pairs:
            '0x2599eba5fd1e49f294c76d034557948034d6c96e,0xe7e90f5a767406eff87fdad7eb07ef407922ec1d'
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
