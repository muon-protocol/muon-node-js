const { axios, soliditySha3, floatToBN } = MuonAppUtils

const APP_ID = 12

function getBalance(address) {
  return axios
    .get(
      'https://dfapiuat.cosmicops.com/crafting/balance/'+address
    )
    .then(({ data }) => data)
    .catch((err) => {
      return err?.response?.data
    })
}

module.exports = {
  APP_NAME: 'gamestarter',

  onRequest: async (request) => {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'claim':
        let { address } = params

        let result = await getBalance(address);

        if (!result.balance || result.balance == 0) {
          throw { message: 'Invalid address' }
        }

        return {
          appId: APP_ID,
          address,
          balance: floatToBN(result.balance, 8).toString(10)
        }

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: (request, result) => {
    let { method } = request
    switch (method) {
      case 'claim':
        let { address } = result
        return soliditySha3([
          { type: 'uint32', value: APP_ID },
          { type: 'address', value: address },
          { type: 'uint256', value: request.data.result.balance}
        ])

      default:
        break
    }
  }
}
