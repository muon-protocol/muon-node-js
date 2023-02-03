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
    REMOTE_CALL_TIMEOUT: 120e3,
    APP_ID: 1,
    owners,

    readOnlyMethods: ['undeploy'],

    undeploy: async function (params) {
        const {
            params: {app}
        } = params

        await this.callPlugin("system", "undeployApp", app);

        return {
            success: true,
        }
    },

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
                if(!await this.verify(hash, seed, nonce))
                    throw `seed not verified`
                break;
            }
            case Methods.TssReshare: {
                const {appId} = params
              const context = await this.callPlugin('system', "getAppContext", appId)
              if(!context) {
                throw `App not deployed`;
              }

              if(context.appName !== 'tss')
                throw `Not allowed for this app`
            }
        }
    },

    onArrive: async function(request) {
        let {
            method,
            data: { params }
        } = request
        switch (method) {
            case Methods.Deploy: {
                const { tssThreshold, maxGroupSize } = await this.callPlugin("system", "getNetworkInfo");
                let {seed, t=tssThreshold, n=maxGroupSize} = params
                t = Math.max(t, tssThreshold);
                return {
                    selectedNodes: this.callPlugin("system", "selectRandomNodes", seed, t, n)
                      .map(node => node.id)
                }
            }
            case Methods.TssKeyGen: {
                const { appId } = params

                /** ensure app context to be exist */
                let context = await this.callPlugin('system', "getAppContext", params.appId)
                if(!context)
                    throw `app deployment info not found`

                const {id, publicKey} = await this.callPlugin('system', "genAppTss", appId)

                return {
                    id,
                    publicKey,
                    partners: context.party.partners,
                }
            }
            case Methods.TssReshare: {
                const {appId} = params
                const reshareNonce = await this.callPlugin('system', "generateReshareNonce", appId, request.data.uid)
                // return {reshareNonce}
            }
        }
    },

    onRequest: async function(request) {
        let {
            method,
            data: { params, init }
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
                const { tssThreshold, maxGroupSize } = await this.callPlugin("system", "getNetworkInfo");
                const {selectedNodes} = init
                let {seed, t=tssThreshold, n=maxGroupSize} = params
                t = Math.max(t, tssThreshold);
                return {
                    timestamp: request.data.timestamp,
                    seed,
                    tssThreshold: t,
                    maxGroupSize: n,
                    selectedNodes,
                };
            }
            case Methods.TssKeyGen: {
                /** ensure app context to be exist */
                let context = await this.callPlugin('system', "getAppContext", params.appId)
                if(!context)
                    throw `app deployment info not found`

                if(context.party.partners.join(',') !== request.data.init.partners.join(',')) {
                    throw `deployed partners mismatched with key-gen partners`
                }

                /** ensure a random key already generated */
                let key = await this.callPlugin('system', "getDistributedKey", init.id)
                if(!key)
                    throw `App new tss key not found`;

                return {
                    address: key.address,
                    publicKey: "0x" + key.publicKey.encode("hex", true),
                    x: '0x' + key.publicKey.getX().toString(16).padStart(64, '0'),
                    yParity: key.publicKey.getY().isEven() ? 0 : 1,
                }
            }

            case Methods.TssReshare: {
                return 'done'
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
            case Methods.TssReshare: {
                return [{t: 'string', v: 'done'}]
            }
            default:
                throw "Unknown method"
        }
    },

    getConfirmAnnounceList: async function(request) {
        switch (request.method) {
            case Methods.Deploy: {
                return request.data.init.selectedNodes
            }
            case Methods.TssKeyGen: {
                return request.data.init.partners
            }
            default:
                return []
        }
    },

    onConfirm: async function(request, result, signatures) {
        let {
            method,
            data: { params, init }
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
                // await this.callPlugin('system', "storeAppTss", appId)
                await this.callPlugin('system', "storeAppTss", appId, init.id)
            }
        }
    }
}
