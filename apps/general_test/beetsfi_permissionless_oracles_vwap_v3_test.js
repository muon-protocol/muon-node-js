require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { dynamicExtend } = require('../../core/utils')
const { tokenPrice } = require('../general/parent_oracles_v3')
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
  pairs: [
    {
      exchange: 'beets',
      pool: 'weighted',
      chainId: '250',
      address: '0x0e8e7307E43301CF28c5d21d5fD3EF0876217D41' // DEI/DEUS
    },
    {
      exchange: 'beets',
      pool: 'stable',
      chainId: '250',
      address: '0x8B858Eaf095A7337dE6f9bC212993338773cA34e' // DEI/USDC
    }
  ]
}

const tokenName2 = 'dei'
const token2 = '0xde12c7959e1a72bbe8a5f7a1dc8f8eef9ab011b3'
const example_2 = {
  token: token2,

  pairs: [
    {
      exchange: 'beets',
      pool: 'stable',
      chainId: '250',
      address: '0x8B858Eaf095A7337dE6f9bC212993338773cA34e'
    }
  ]
}

const tokenName3 = 'beFTM'
const token3 = '0x7381eD41F6dE418DdE5e84B55590422a57917886'
const example_3 = {
  token: token3,

  pairs: [
    {
      exchange: 'beets',
      pool: 'stable',
      chainId: '250',
      address: '0x3bd4c3d1f6F40d77B2e9d0007D6f76E4F183A46d' // wFTM -beFTM
    },
    {
      exchange: 'beets',
      pool: 'weighted',
      chainId: '250',
      address: '0xf3A602d30dcB723A74a0198313a7551FEacA7DAc' //  wFTM - wBTC - wETH - USDC
    }
  ]
}

// testPrice(example_1, token, tokenName)
// testPrice(example_2, token2, tokenName2)
testPrice(example_3, token3, tokenName3)
