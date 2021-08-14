const { axios, soliditySha3 } = MuonAppUtils

const APP_ID = 10

async function getMilestoneReached(signature, milestoneId, address, time, tag) {
  const result = await axios.get(
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
          signature,
          time,
          address,
          milestoneId,
          tag
        }

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: (request, result) => {
    let { method } = request
    switch (method) {
      case 'claim':
        let { address, milestoneId, signature, tag } = result
        return soliditySha3([
          { type: 'uint256', value: APP_ID },
          { type: 'string', value: signature },
          { type: 'uint256', value: request.data.result.time },
          { type: 'address', value: address },
          { type: 'uint256', value: milestoneId },
          { type: 'string', value: tag }
        ])

      default:
        break
    }
  }
}
