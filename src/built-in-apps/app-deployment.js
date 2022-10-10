// const {  } = MuonAppUtils

const Methods = {
    Check: "check",
    RandomSeed: "random-seed",
    Deploy: "deploy",
    TssKeyGen: "tss-key-gen",
    TssReshare: "tss-reshare"
}

const owners = [
  "0x340C978265378998D589B41F1f51F137c344C22a"
]

module.exports = {
    APP_NAME: "deployment",
    APP_ID: 1,
    owners,

    validateRequest: async function(request) {
        let {
            method,
            data: { params }
        } = request
        switch (method) {
            case Methods.RandomSeed: {
                const {appId} = params
                const {deployed} = await this.callPlugin('system', "getAppStatus", appId)
                if(deployed)
                    throw `App already deployed`
                break;
            }
            case Methods.Deploy: {
                const {appId, seed, nonce, reqId} = params
                const context = await this.callPlugin('system', "getAppContext", appId)
                if(!!context) {
                    throw `App already deployed`;
                }

                const randomSeedRequest = {...request, method: Methods.RandomSeed, reqId}
                const seedResult = await this.onRequest(randomSeedRequest)
                const seedSignParams = this.signParams(randomSeedRequest, seedResult)
                const hash = this.hashAppSignParams(randomSeedRequest, seedSignParams)
                if(!this.verify(hash, seed, nonce))
                    throw `seed not verified`
                break;
            }
        }
    },

    onArrive: async function(request) {
        let {
            method,
            data: { params }
        } = request
        switch (method) {
            case Methods.TssKeyGen: {
                const { appId } = params
                // await this.callPlugin('system', "newAppTss", appId)
                return {
                    publicKey: await this.callPlugin('system', "genAppTss", appId)
                }
            }
        }
    },

    onRequest: async function(request) {
        let {
            method,
            data: { params }
        } = request
        switch (method) {
            case Methods.Check: {
                const {appId} = params
                const status = await this.callPlugin('system', "getAppStatus", appId)
                return status;
            }
            case Methods.RandomSeed: {
                const {previous = "0x0", appId} = params
                if (!appId)
                    throw "appId is undefined"
                return {previous, appId}
            }
            case Methods.Deploy: {
                const {seed, appId} = params
                const { tssThreshold, maxGroupSize } = await this.callPlugin("system", "getNetworkInfo");
                return {
                    timestamp: request.data.timestamp,
                    seed,
                    tssThreshold,
                    maxGroupSize,
                    selectedNodes: this.callPlugin("system", "selectRandomNodes", seed, tssThreshold, maxGroupSize)
                        .map(node => node.id)
                };
            }
            case Methods.TssKeyGen: {
                const {appId} = params
                let key = await this.callPlugin('system', "getAppTss", appId)
                if(!key)
                    throw `App new tss key not found`;
                return {
                    address: key.address,
                    publicKey: "0x" + key.publicKey.encode('hex', true),
                    x: "0x" + key.publicKey.x.toString('hex'),
                    yParity: key.publicKey.y.isEven() ? 0 : 1,
                }
            }
            default:
                throw "Unknown method"
        }
    },

    signParams: function(request, result) {
        switch (request.method) {
            case Methods.Check: {
                const { deployed, version } = result
                if(!deployed || version < 0) {
                    return [
                        {t: "bool", v: deployed},
                    ]
                }
                else {
                    return [
                        {t: "bool", v: deployed},
                        {t: "uint64", v: version},
                    ]
                }
            }
            case Methods.RandomSeed:
                return [
                    {type: "uint256", value: result.previous},
                    {type: "uint256", value: result.appId},
                ];
            case Methods.Deploy: {
                const {seed} = request.data.params
                return [
                    {t: 'uint64', v: result.timestamp},
                    {t: 'uint256', v: seed},
                    ...result.selectedNodes.map(v => ({t: 'uint64', v}))
                ]
            }
            case Methods.TssKeyGen: {
                const {appId} = request.data.params
                return [
                    {t: 'address', v:request.data.result.address}
                ]
            }
            default:
                throw "Unknown method"
        }
    },

    onConfirm: async function(request, result, signatures) {
        let {
            method,
            data: { params }
        } = request
        switch (method) {
            case Methods.Deploy: {
                let success = await this.callPlugin(
                    "system",
                    "storeAppContext",
                    request, result
                )
                if(!success)
                    throw "Fail to store app TSS key."
                break
            }
            case Methods.TssKeyGen: {
                const {appId} = params
                await this.callPlugin('system', "storeAppTss", appId)
            }
        }
    }
}
