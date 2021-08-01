const { axios, soliditySha3 } = MuonAppUtils

async function getMilestoneReached(signature, milestoneId, address, time) {
  const result = await axios.get(
    'https://api.fearnft.games/api/MilestoneReached',
    {
      headers: {
        signature,
        milestoneId,
        address,
        time
      }
    }
  )

  return result.data
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
        let { address, milestoneId, signature, time } = params

        if (!milestoneId) throw { message: 'Invalid milestone Id' }
        if (!time) throw { message: 'invalid claim time' }
        if (!address) throw { message: 'Invalid sender address' }
        if (!signature) throw { message: 'Request signature undefined' }

        let result = await getMilestoneReached(
          signature,
          milestoneId,
          address,
          time
        )
        if (!result.reached) {
          throw { message: 'address not allowed for claim' }
        }

        return {
          signature,
          time,
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
        let { address, milestoneId, signature } = result
        return soliditySha3([
          { type: 'string', value: signature },
          { type: 'uint256', value: request.data.result.time },
          { type: 'address', value: address },
          { type: 'uint256', value: milestoneId }
        ])

      default:
        break
    }
  }
}
