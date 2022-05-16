require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { onRequest } = require('../general/deus_twap')

const test= async () => {
  return onRequest({
    method:'price',
    data: {
      params: {
        timestamp: 1652724015
      }
    }
  })
    .then((response) => {
      console.log(response);
    })
    .catch((error) => console.log(error))
}

test()
