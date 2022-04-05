const { axios, soliditySha3, floatToBN } = MuonAppUtils

const APP_ID = 10

const getTimestamp = () => Math.floor(Date.now() / 1000)

function getMilestoneReached(address, signature, message, amount, chain) {
  return axios
    .post(
      'https://api.fear.io/api/claimReward',
      {
        address,
        signature,
        message,
        amount,
        chain
      },
      {
        timeout: 60000
      }
    )
    .then(({ data }) => data)
    .catch((err) => {
      return err?.response?.data
    })
}

module.exports = {
  APP_NAME: 'fear_game',
  REMOTE_CALL_TIMEOUT: 30000,

  onRequest: async (request) => {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'claim':
        let { address, signature, message, chain, amount } = params
        if (!message) throw { message: 'Invalid message' }
        if (!address) throw { message: 'Invalid sender address' }
        if (!signature) throw { message: 'Request signature undefined' }
        if (!amount) throw { message: 'Invalid amount' }
        if (!chain) throw { message: 'Invalid chain' }

        let result = await getMilestoneReached(
          address,
          signature,
          message,
          amount,
          chain
        )
        if (!result.claimed || result.reward == 0) {
          if (result?.eid?.message) throw { message: result.eid.message }
          else throw { message: 'address not allowed for claim' }
        }

        return {
          appId: APP_ID,
          address,
          reward: floatToBN(result.reward, 18).toString(10),
          trackingId: result.trackingId,
          chain,
          muonTimestamp: request.data.timestamp
        }

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: (request, result) => {
    let { method } = request
    switch (method) {
      case 'claim':
        let { address, reward, chain } = result
        return soliditySha3([
          { type: 'uint256', value: APP_ID },
          { type: 'address', value: address },
          { type: 'uint256', value: reward },
          { type: 'string', value: request.data.result.trackingId },
          { type: 'uint256', value: chain },
          { type: 'uint256', value: request.data.result.muonTimestamp }
        ])

      default:
        break
    }
  }
}
