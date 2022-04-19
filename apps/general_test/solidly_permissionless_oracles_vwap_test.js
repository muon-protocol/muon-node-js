require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { onRequest } = require('../general/solidly_permissionless_oracles_vwap')

const testLP = async () => {
  let method = 'lp_price'
  const { tokenPrice, volume } = await onRequest({
    method,
    data: {
      params: {
        token: '0xF42dBcf004a93ae6D5922282B304E2aEFDd50058',
        pairs0: '0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0',
        pairs1:
          '0xF42dBcf004a93ae6D5922282B304E2aEFDd50058,0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0'
      }
    }
  })
  console.log({ tokenPrice, volume })
}

testLP()
