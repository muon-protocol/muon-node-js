const { axios, soliditySha3 } = MuonAppUtils

const APP_ID = 10

function getMilestoneReached(signature, milestoneId, address, time, tag) {
  return axios.get(
    'https://api.fearnft.games/api/MilestoneReached',
    {
      headers: {
        signature,
        milestoneId,
        address,
        time,
        tag
      }
    }
  ).then(({data}) => data)
}

module.exports = {
  APP_NAME: 'fear_game',
  isService: true,

  onRequest: async (request) => {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'claim':
        let { address, milestoneId, signature, time, tag } = params
        if (!milestoneId) throw { message: 'Invalid milestone Id' }
        if (!time) throw { message: 'invalid claim time' }
        if (!address) throw { message: 'Invalid sender address' }
        if (!signature) throw { message: 'Request signature undefined' }
        if (!tag) throw { message: 'Invalid tag' }

        let result = await getMilestoneReached(
          signature,
          milestoneId,
          address,
          time,
          tag
        )

        if (!result.reached) {
          throw { message: 'address not allowed for claim' }
        }

        return {
          appId: APP_ID,
          address,
          milestoneId
        }

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: (request, result) => {
    let { method } = request
    switch (method) {
      case 'claim':
        let { address, milestoneId } = result
        return soliditySha3([
          { type: 'uint256', value: APP_ID },
          { type: 'address', value: address },
          { type: 'uint256', value: milestoneId }
        ])

      default:
        break
    }
  }
}
