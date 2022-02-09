const { axios, soliditySha3, floatToBN } = MuonAppUtils

const APP_ID = 11

const getTimestamp = () => Math.floor(Date.now() / 1000)

function getRewards(address) {
  if(address == "0x7E9e166eEC3AFFe3BD2b1175849f73D6Eb53bAfE"){
    return {rewards: 100}
  }
  return axios
    .get(
      'https://carebigtoken.io/api/public/rewards/'+address
    )
    .then(({ data }) => data)
    .catch((err) => {
      return err?.response?.data
    })
}

module.exports = {
  APP_NAME: 'carebig',

  onRequest: async (request) => {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'claim':
        let { address } = params

        let result = await getRewards(address);

        if (!result.rewards || result.rewards == 0) {
          throw { message: 'address not allowed for claim' }
        }

        return {
          appId: APP_ID,
          address,
          rewards: floatToBN(result.rewards, 18).toString(10)
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
          { type: 'uint8', value: APP_ID },
          { type: 'address', value: address },
          { type: 'uint256', value: request.data.result.rewards}
        ])

      default:
        break
    }
  }
}
