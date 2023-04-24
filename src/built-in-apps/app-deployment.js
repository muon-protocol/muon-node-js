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

/** one week */
const DEFAULT_APP_TTL = 7*24*3600;

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
                const {deployed, status} = this.callPlugin('system', "getAppLastDeploymentInfo", appId)
                if(deployed && status !== 'PENDING')
                    throw `App already deployed`
                break;
            }
            case Methods.Deploy: {
                const {appId, seed, nonce, reqId} = params
                const context = await this.callPlugin('system', "getAppContext", appId, seed)
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
            case Methods.TssKeyGen: {
                const {appId, seed} = params
                if(!appId || !seed)
                    throw `Missing params appId/seed.`
                const {status} = this.callPlugin('system', "getAppDeploymentInfo", appId, seed)
                if(status !== "TSS_GROUP_SELECTED")
                    throw `App context is not in key generation state. The state is currently ${status}.`
                break;
            }
            case Methods.TssReshare: {
                const {appId, seed} = params
              const context = await this.callPlugin('system', "getAppContext", appId, seed)
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
                const { tss: tssConfigs } = await this.callPlugin("system", "getNetworkConfigs");
                let {seed, t=tssConfigs.threshold, n=tssConfigs.max} = params
                t = Math.max(t, tssConfigs.threshold);
                const selectedNodes = await this.callPlugin("system", "selectRandomNodes", seed, t, n);
                return {
                    selectedNodes: selectedNodes.map(node => node.id)
                }
            }
            case Methods.TssKeyGen: {
                const { appId, seed } = params

                /** ensure app context to be exist */
                let context = await this.callPlugin('system', "getAppContext", appId, seed)
                if(!context)
                    throw `app deployment info not found`

                const {id, publicKey, generators} = await this.callPlugin('system', "generateAppTss", appId, seed)

                return {
                    id,
                    publicKey,
                    partners: context.party.partners,
                    keyGenerators: generators
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
                const status = this.callPlugin('system', "getAppLastDeploymentInfo", appId)
                return status;
            }
            case Methods.RandomSeed: {
                const {previous = "0x0", appId} = params
                if (!appId)
                    throw "appId is undefined"
                return {previous, appId}
            }
            case Methods.Deploy: {
                const { tss: tssConfigs } = await this.callPlugin("system", "getNetworkConfigs");
                const {selectedNodes} = init
                let {seed, t=tssConfigs.threshold, n=tssConfigs.max} = params
                t = Math.max(t, tssConfigs.threshold);
                return {
                    rotationEnabled: true,
                    ttl: DEFAULT_APP_TTL,
                    timestamp: request.data.timestamp,
                    seed,
                    tssThreshold: t,
                    maxGroupSize: n,
                    selectedNodes,
                };
            }
            case Methods.TssKeyGen: {
                const {appId, seed} = params
                /** ensure app context to be exist */
                let context = await this.callPlugin('system', "getAppContext", appId, seed)
                if(!context)
                    throw `app deployment info not found`

                const { tss: tssConfigs } = await this.callPlugin("system", "getNetworkConfigs");

                if(context.party.partners.join(',') !== request.data.init.partners.join(',')) {
                    throw `deployed partners mismatched with key-gen partners`
                }

                /** ensure a random key already generated */
                let publicKey = await this.callPlugin('system', "findAndGetAppPublicKey", appId, seed, init.id)
                if(!publicKey)
                    throw `App new tss key not found`;

                return {
                    rotationEnabled: true,
                    ttl: DEFAULT_APP_TTL,
                    expiration: request.data.timestamp + DEFAULT_APP_TTL + tssConfigs.pendingPeriod,
                    seed: context.seed,
                    publicKey
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
                const { deployed, status } = result
                return [
                  {t: "bool", v: deployed},
                  {t: "string", v: status},
                ]
            }
            case Methods.RandomSeed:
                return [
                    {type: "uint256", value: result.previous},
                    {type: "uint256", value: result.appId},
                ];
            case Methods.Deploy: {
                const {seed} = request.data.params
                return [
                    {t: 'bool', v: result.rotationEnabled},
                    {t: 'uint64', v: result.ttl},
                    {t: 'uint64', v: result.timestamp},
                    {t: 'uint256', v: seed},
                    ...result.selectedNodes.map(v => ({t: 'uint64', v}))
                ]
            }
            case Methods.TssKeyGen: {
                const {appId} = request.data.params
                return [
                    {t: "bool", v: request.data.result.rotationEnabled},
                    {t: "uint64", v: request.data.result.ttl},
                    {t: "uint64", v: request.data.result.expiration},
                    {t: "string", v: request.data.result.seed},
                    {t: 'address', v:request.data.result.publicKey.address}
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
                return request.data.init.keyGenerators
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
                    "appDeploymentConfirmed",
                    request, result
                )
                if(!success)
                    throw "Fail to store app context."
                break
            }
            case Methods.TssKeyGen: {
                const {appId} = params
                // await this.callPlugin('system', "storeAppTss", appId, init.id)
                await this.callPlugin('system', "appKeyGenConfirmed", request)
            }
        }
    }
}
