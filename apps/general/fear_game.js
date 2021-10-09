const { axios, soliditySha3, floatToBN } = MuonAppUtils

const APP_ID = 10

function getMilestoneReached(address, signature, message) {
  return axios
    .post('https://api.fear.io/api/claimReward', '', {
      timeout: 60000,
      headers: {
        address,
        signature,
        message
      }
    })
    .then(({ data }) => data)
}

module.exports = {
  APP_NAME: 'fear_game',

  onRequest: async (request) => {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'claim':
        let { address, signature, message } = params
        if (!message) throw { message: 'Invalid message' }
        if (!address) throw { message: 'Invalid sender address' }
        if (!signature) throw { message: 'Request signature undefined' }

        let result = await getMilestoneReached(address, signature, message)
        // TODO change condition after test
        // if (!result.claimed || result.reward == 0) {
        if (!result.claimed) {
          throw { message: 'address not allowed for claim' }
        }

        return {
          appId: APP_ID,
          address,
          trackingId: result.trackingId,
          reward: floatToBN(result.reward, 18).toString(10)
        }

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: (request, result) => {
    let { method } = request
    switch (method) {
      case 'claim':
        let { address, reward } = result

        return soliditySha3([
          { type: 'uint256', value: APP_ID },
          { type: 'address', value: address },
          { type: 'string', value: request.data.result.trackingId },
          { type: 'uint256', value: reward }
        ])

      default:
        break
    }
  }
}
