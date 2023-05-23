const {
    lodash,
  soliditySha3,
} = MuonAppUtils

const Methods = {
    Check: "check",
    RandomSeed: "random-seed",
    Deploy: "deploy",
    TssKeyGen: "tss-key-gen",
    TssRotate: "tss-rotate",
    TssReshare: "tss-reshare"
}

const owners = [
  "0x340C978265378998D589B41F1f51F137c344C22a"
]

const ROTATION_COEFFICIENT = 1.5;

function shuffleNodes(nodes, seed) {
    let unsorted = nodes.map(id => {
        return {
            id,
            hash: soliditySha3([
             {type: "uint64", value: id},
             {type: "uint256", value: seed},
         ])
        }
    })
    let sorted = unsorted.sort((a, b) => (a.hash < b.hash ? -1 : 1))
    return sorted.map(({id}) => id)
}

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

    /**
     * Verify that this seed is generated for deployment
     *
     * @param request {AppRequest} - current request
     * @param seed {string} - random seed value
     * @param reqId {string} - random seed generation request ID
     * @param nonce {string} - nonce address that used for seed generation
     * @returns {Promise<void>} - will return successfully if seed was ok.
     */
    validateSeed: async function(request, seed, reqId, nonce) {
      const randomSeedRequest = {...request, method: Methods.RandomSeed, reqId}
      const seedResult = await this.onRequest(randomSeedRequest)
      const seedSignParams = this.signParams(randomSeedRequest, seedResult)
      const hash = this.hashAppSignParams(randomSeedRequest, seedSignParams)
      if(!await this.verify(hash, seed, nonce))
        throw `seed not verified`
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
                const {
                    appId,
                    seed: {value: seed, nonce, reqId},
                    nodes,
                    ttl,
                    pendingPeriod
                } = params
                if(ttl !== undefined && parseInt(ttl) <= 0)
                    throw "Invalid app deployment ttl"
                if(pendingPeriod != undefined && parseInt(pendingPeriod) <= 0)
                    throw "Invalid app pending period"
                if(nodes !== undefined) {
                    for (const id of nodes) {
                        if (parseInt(id) <= 0)
                            throw `Invalid node ID in nodes list`;
                    }
                }
                const context = await this.callPlugin('system', "getAppContext", appId, seed)
                if(!!context) {
                    throw `App already deployed`;
                }
                await this.validateSeed(request, seed, reqId, nonce);
                break;
            }
            case Methods.TssKeyGen: {
                const {appId, seed} = params
                if(!appId || !seed)
                    throw { message: `Missing params appId/seed.`, params}
                const {status} = this.callPlugin('system', "getAppDeploymentInfo", appId, seed)
                if(status !== "TSS_GROUP_SELECTED")
                    throw `App context is not in key generation state. The state is currently ${status}.`
                break;
            }
            case Methods.TssRotate: {
                const {
                    appId,
                    previousSeed,
                    seed: {value: seed, reqId, nonce},
                    nodes,
                    ttl,
                    pendingPeriod
                } = params
                if(ttl !== undefined && parseInt(ttl) <= 0)
                    throw "Invalid app deployment ttl"
                if(pendingPeriod != undefined && parseInt(pendingPeriod) <= 0)
                    throw "Invalid app pending period"
                if(nodes !== undefined) {
                    for (const id of nodes) {
                        if (parseInt(id) <= 0)
                            throw `Invalid node ID in nodes list`;
                    }
                }

                const oldContext = await this.callPlugin('system', "getAppContext", appId, previousSeed, true)

                if(!oldContext)
                    throw `App previous context not found on the deployment app's validateRequest method`

                /** Most recent status of App should be PENDING (about to expire) */
                const {status} = this.callPlugin('system', "getAppDeploymentInfo", appId, previousSeed)

                if(status !== 'PENDING' && status !== 'EXPIRED')
                    throw `Previous context status is not PENDING/EXPIRED. It is ${status}`

                await this.validateSeed(request, seed, reqId, nonce);
                break
            }
            case Methods.TssReshare: {
                const {appId, seed} = params

                /** ensure the app's context exists */
                let newContext = await this.callPlugin('system', "getAppContext", appId, seed, true)
                if(!newContext || !newContext.previousSeed)
                    throw `The App's new deployment info not found`

                /** ensure the app's previous context exists */
                let previousContext = await this.callPlugin('system', "getAppContext", appId, newContext.previousSeed, true)
                if(!previousContext)
                  throw `The App's previous deployment info not found`

                /** Most recent status of App should be PENDING (about to expire) */
                const newInfo = this.callPlugin('system', "getAppDeploymentInfo", appId, seed)

                if(!newInfo.deployed || newInfo.status !== 'TSS_GROUP_SELECTED')
                    throw {message: `App not rotated.`, deploymentInfo: newInfo}

                const oldInfo = this.callPlugin('system', "getAppDeploymentInfo", appId, newContext.previousSeed)

                if(oldInfo.status !== 'PENDING' && oldInfo.status !== "EXPIRED")
                    throw `App key cannot be reshared`

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
            case Methods.Deploy:
            case Methods.TssRotate: {
                const { tss: tssConfigs } = await this.callPlugin("system", "getNetworkConfigs");
                let {
                    appId,
                    previousSeed,
                    seed: {value: seed},
                    t=tssConfigs.threshold,
                    n=tssConfigs.max,
                    nodes,
                } = params;

                t = Math.max(t, tssConfigs.threshold);
                /** Choose a few nodes at random to join the party */
                let selectedNodes;
                if(!!nodes) {
                    selectedNodes = nodes
                }
                else {
                    selectedNodes = await this.callPlugin("system", "selectRandomNodes", seed, t, n);
                    selectedNodes = selectedNodes.map(({id}) => id)
                }
                let previousNodes;
                if(method === Methods.TssRotate) {
                    const prevContext = await this.callPlugin("system", "getAppContext", appId, previousSeed);
                    if (!prevContext)
                        throw {message: `App previous context missing on deployment onArrive method`, appId, seed};
                    previousNodes = prevContext.party.partners
                    /** Pick some nodes to retain in the new party */
                    const countToKeep = Math.ceil(t * ROTATION_COEFFICIENT);
                    const nodesToKeep = shuffleNodes(previousNodes, seed).slice(0, countToKeep)
                    /** Merge nodes and retain n nodes */
                    selectedNodes = lodash.uniq([...nodesToKeep, ...selectedNodes]).slice(0, n);
                }
                return {
                    previousNodes,
                    selectedNodes,
                }
            }
            case Methods.TssKeyGen: {
                const { appId, seed } = params

                const {id, publicKey, generators} = await this.callPlugin('system', "generateAppTss", appId, seed)

                let context = await this.callPlugin('system', "getAppContext", appId, seed, true)

                return {
                    id,
                    publicKey,
                    partners: context.party.partners,
                    keyGenerators: generators
                }
            }
            case Methods.TssReshare: {
                const { appId, seed } = params

                /** ensure app context to be exist */
                let context = await this.callPlugin('system', "getAppContext", appId, seed, true)

                const {id, publicKey, generators} = await this.callPlugin('system', "reshareAppTss", appId, seed)

                return {
                    id,
                    publicKey,
                    partners: context.party.partners,
                    keyGenerators: generators
                }
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
                const {previousSeed = "0x0", appId} = params
                if (!appId)
                    throw "appId is undefined"
                return {previousSeed, appId}
            }
            case Methods.Deploy: {
                const { tss: tssConfigs } = await this.callPlugin("system", "getNetworkConfigs");
                const {selectedNodes} = init
                let {
                    appId,
                    seed: {value: seed},
                    t=tssConfigs.threshold,
                    n=tssConfigs.max,
                    ttl: userDefinedTTL,
                    pendingPeriod: pending,
                } = params
                const ttl = !!userDefinedTTL ? userDefinedTTL : await this.callPlugin("system", "getAppTTL", appId);

                t = Math.max(t, tssConfigs.threshold);
                const pendingPeriod = !!pending ? pending : tssConfigs.pendingPeriod

                return {
                    rotationEnabled: true,
                    ttl,
                    pendingPeriod,
                    expiration: request.data.timestamp + ttl + pendingPeriod,
                    timestamp: request.data.timestamp,
                    seed,
                    tssThreshold: t,
                    maxGroupSize: n,
                    selectedNodes,
                };
            }
            case Methods.TssRotate: {
                const { tss: tssConfigs } = await this.callPlugin("system", "getNetworkConfigs");
                const {previousNodes, selectedNodes} = init
                let {
                    appId,
                    previousSeed,
                    seed: {value: seed},
                    t=tssConfigs.threshold,
                    n=tssConfigs.max,
                    ttl: userDefinedTTL,
                    pendingPeriod: pending,
                } = params

                const prevContext = await this.callPlugin("system", "getAppContext", appId, previousSeed);
                if (!prevContext)
                    throw {message: `App previous context missing on deployment onArrive method`, appId, seed};

                const ttl = !!userDefinedTTL ? userDefinedTTL : prevContext.ttl;
                const pendingPeriod = !!pending ? pending : prevContext.pendingPeriod;

                t = Math.max(t, tssConfigs.threshold);

                return {
                    rotationEnabled: true,
                    ttl,
                    pendingPeriod,
                    expiration: request.data.timestamp + ttl + pendingPeriod,
                    timestamp: request.data.timestamp,
                    previousSeed,
                    seed,
                    tssThreshold: t,
                    maxGroupSize: n,
                    previousNodes,
                    selectedNodes,
                };
            }
            case Methods.TssKeyGen:
            case Methods.TssReshare: {
                const {appId, seed} = params
                /** ensure app context to be exist */
                let context = await this.callPlugin('system', "getAppContext", appId, seed, true)
                if(!context)
                    throw `The app's deployment info was not found`

                const { tss: tssConfigs } = await this.callPlugin("system", "getNetworkConfigs");
                const ttl = await this.callPlugin("system", "getAppTTL", appId);

                if(context.party.partners.join(',') !== request.data.init.partners.join(',')) {
                    throw `deployed partners mismatched with key-gen partners`
                }

                /** ensure a random key already generated */
                let publicKey;
                if(method === Methods.TssKeyGen) {
                    publicKey = await this.callPlugin('system', "findAndGetAppPublicKey", appId, seed, init.id)
                }
                else {
                    const oldContext = await this.callPlugin("system", "getAppContext", appId, context.previousSeed, true)
                    publicKey = oldContext.publicKey;
                }

                if(!publicKey)
                    throw `App new tss key not found`;

                return {
                    rotationEnabled: true,
                    ttl,
                    expiration: request.data.timestamp + ttl + tssConfigs.pendingPeriod,
                    seed: context.seed,
                    publicKey
                }
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
                    {type: "uint256", value: result.previousSeed},
                    {type: "uint256", value: result.appId},
                ];
            case Methods.Deploy:
            case Methods.TssRotate: {
                const {
                    previousSeed,
                    seed: {value: seed}
                } = request.data.params
                return [
                    {t: 'bool', v: result.rotationEnabled},
                    {t: 'uint64', v: result.ttl},
                    {t: 'uint64', v: result.pendingPeriod},
                    {t: 'uint64', v: result.expiration},
                    {t: 'uint64', v: result.timestamp},
                    ...(request.method === Methods.TssRotate ? [{t: 'uint256', v: previousSeed}] : []),
                    {t: 'uint256', v: seed},
                    ...result.selectedNodes.map(v => ({t: 'uint64', v}))
                ]
            }
            case Methods.TssKeyGen:
            case Methods.TssReshare: {
                const {appId} = request.data.params
                return [
                    {t: "bool", v: request.data.result.rotationEnabled},
                    {t: "uint64", v: request.data.result.ttl},
                    {t: "uint64", v: request.data.result.expiration},
                    {t: "string", v: request.data.result.seed},
                    {t: 'address', v:request.data.result.publicKey.address}
                ]
            }
            default:
                throw "Unknown method"
        }
    },

    getConfirmAnnounceGroups: async function(request) {
        let {
            method,
            data: { params, init }
        } = request

        switch (method) {
            case Methods.Deploy: {
                return [
                  init.selectedNodes,
                ]
            }
            case Methods.TssRotate: {
                return [
                  /** inform the partners of new context */
                  init.selectedNodes,
                    /** inform the partners of previous context that retained in new context */
                  init.previousNodes.filter(id => init.selectedNodes.includes(id))
                ]
            }
            case Methods.TssKeyGen: {
                return [
                    /**  Inform the partners who participated in the keygen process. */
                  init.keyGenerators
                ]
            }
            case Methods.TssReshare: {
                const {appId, seed} = params
                const newContext = await this.callPlugin("system", "getAppContext", appId, seed, true);
                const previousContext = await this.callPlugin("system", "getAppContext", appId, newContext.previousSeed, true)
                return [
                  newContext.party.partners,
                  /** Overlap of two party. */
                  newContext.party.partners.filter(id => previousContext.party.partners.includes(id)),
                ]
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
            case Methods.Deploy:
            case Methods.TssRotate: {
                let success = await this.callPlugin(
                    "system",
                    "appDeploymentConfirmed",
                    request, result
                )
                if(!success)
                    throw "Fail to store app context."
                break;
            }
            case Methods.TssKeyGen: {
                await this.callPlugin('system', "appKeyGenConfirmed", request)
                break
            }
            case Methods.TssReshare: {
                await this.callPlugin('system', "appReshareConfirmed", request)
                break
            }
        }
    }
}
