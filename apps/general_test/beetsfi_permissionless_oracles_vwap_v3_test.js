require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { dynamicExtend } = require('../../core/utils')
const BeetsFi = dynamicExtend(
  class {},
  require('../general/beetsfi_permissionless_oracles_vwap_v3')
)

const app = new BeetsFi()

const testPrice = async (params, token, tokenName) => {
  let method = 'price'

  return app
    .onRequest({
      method,
      data: {
        params
      }
    })
    .then(({ tokenPrice, volume }) => {
      console.log(`\n \nResult for PRICE ${tokenName}: ${token}`)
      console.log({ tokenPrice, volume })
    })
    .catch((error) => console.log(error))
}

const tokenName = 'DEUS'
const token = '0xDE5ed76E7c05eC5e4572CfC88d1ACEA165109E44' // token:deus
const example_1 = {
  token,
  start: 1652067389,
  end: 1652075389,
  pairs: [
    {
      exchange: 'beets',
      chainId: '250',
      address: '0x0e8e7307E43301CF28c5d21d5fD3EF0876217D41' // DEI/DEUS
    },
    {
      exchange: 'beets',
      chainId: '250',
      address: '0xDFc65c1F15AD3507754EF0fd4BA67060C108db7E' // DEI/USDC
    }
  ]
}

testPrice(example_1, token, tokenName)
