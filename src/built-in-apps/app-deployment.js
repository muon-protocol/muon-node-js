// const {  } = MuonAppUtils

const Methods = {
    RandomSeed: "random-seed",
    Deploy: "deploy"
}

module.exports = {
    APP_NAME: "deployment",
    APP_ID: 1,

    onRequest: async function(request) {
        let {
            method,
            data: { params }
        } = request
        switch (method) {
            case Methods.RandomSeed: {
                const {previous = "0x0", appId} = params
                if (!appId)
                    throw "appId is undefined"
                return {previous, appId}
            }
            case "deploy": {
                const {seed, previousSeed = "0x0", appId, nonce, reqId} = params
                const randomSeedRequest = {...request, method: Methods.RandomSeed, reqId}
                const seedResult = await this.onRequest(randomSeedRequest)
                const seedSignParams = this.signParams(randomSeedRequest, seedResult)
                const hash = this.hashAppSignParams(randomSeedRequest, seedSignParams)
                if(!this.verify(hash, seed, nonce))
                    throw `seed not verified`
                return seed
            }
            default:
                throw "Unknown method"
        }
    },

    signParams: function(request, result) {
        switch (request.method) {
            case Methods.RandomSeed:
                return [
                    {type: "uint256", value: result.appId},
                    {type: "uint256", value: result.previous}
                ];
            case Methods.Deploy:
                return [
                    {type: "uint256", value: result}
                ]
            default:
                throw "Unknown method"
        }
    }
}
