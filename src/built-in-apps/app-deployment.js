const {
    lodash,
    muonSha3,
    ecRecover,
} = MuonAppUtils

const Methods = {
    Check: "check",
    RandomSeed: "random-seed",
    Deploy: "deploy",
    TssKeyGen: "tss-key-gen",
    TssRotate: "tss-rotate",
    TssReshare: "tss-reshare"
}

const NODES_SELECTION_TOLERANCE = 0.07;
const ROTATION_COEFFICIENT = 1.5;

function shuffleNodes(nodes, seed) {
    let unsorted = nodes.map(id => {
        return {
            id,
            hash: muonSha3(
             {type: "uint64", value: id},
             {type: "uint256", value: seed}
             )
        }
    })
    let sorted = unsorted.sort((a, b) => (a.hash < b.hash ? -1 : 1))
    return sorted.map(({id}) => id)
}

function symmetricDifference(arrA, arrB) {
    const _difference = new Set(arrA);
    for (const elem of new Set(arrB)) {
        if (_difference.has(elem)) {
            _difference.delete(elem);
        } else {
            _difference.add(elem);
        }
    }
    return Array.from(_difference);
}

const uint32Schema = {
    type: 'string',
    customType: "uint32"
};
const appIdSchema = {
    type: "string",
    customType: 'decimal',
    errorMessage: {
        type: "appId is not string type",
        customType: "appId is not decimal number"
    }
}
const ethAddressSchema = {
    type: 'string',
    customType: "ethAddress",
}

const verifiableSeedSchema = {
    type: "object",
    properties: {
        value: uint32Schema,
        reqId: uint32Schema,
        nonce: ethAddressSchema,
    },
    required: ["value", "reqId", "nonce"],
}

const METHOD_PARAMS_SCHEMA = {
    [Methods.Check]:{
        type: 'object',
        properties: {
            appId: appIdSchema,
        },
        required: ["appId"]
    },
    [Methods.RandomSeed]:{
      type: 'object',
      properties: {
          appId: appIdSchema,
          previousSeed: uint32Schema
      },
      required: ["appId"]
    },
    [Methods.Deploy]: {
        type: "object",
        properties: {
            appId: appIdSchema,
            seed: verifiableSeedSchema,
            nodes: {
                type: "array",
                items: {
                    type: "string",
                    customType: 'decimal',
                    errorMessage: {
                      type: "nodes list item must be an array of decimal numbers",
                    }
                },
                errorMessage: {
                  type: "nodes list must be string array"
                }
            },
            t: {type: "integer", minimum: 2},
            n: {type: "integer", minimum: 2},
            ttl: {
              type: "integer",
              minimum: 10,
              errorMessage: {
                type: "ttl is not integer value.",
                minimum: "ttl is lower than minimum."
              }
            },
            pendingPeriod: {
                type: "integer",
                minimum: 1
            },
        },
        required: ["appId", "seed"]
    },
    [Methods.TssKeyGen]: {
        type: "object",
        properties: {
            appId: appIdSchema,
            seed: uint32Schema,
        },
        required: ["appId", "seed"]
    },
    [Methods.TssRotate]: {
        type: "object",
        properties: {
            appId: appIdSchema,
            seed: verifiableSeedSchema,
            previousSeed: uint32Schema,
            nodes: {
                type: "array",
                items: {
                    type: "string",
                    customType: "decimal",
                    errorMessage: {
                        type: "nodes list item must be string",
                        customType: "nodes list item must be decimal number",
                    }
                },
                errorMessage: {
                    type: "nodes list must be string array"
                }
            },
            n: {type: "integer", minimum: 2},
            ttl: {type: "integer", minimum: 10},
            pendingPeriod: {type: "integer", minimum: 1},
            leaderSignature: {type: "string", customType: "ethSignature"},
        },
        required: ["appId", "seed", "previousSeed", "leaderSignature"],
        additionalProperties: false,
    },
    [Methods.TssReshare]: {
        type: "object",
        properties: {
            appId: appIdSchema,
            seed: uint32Schema,
            leaderSignature: {type: "string", customType: "ethSignature"},
        },
        required: ["appId", "seed", "leaderSignature"]
    },
}

module.exports = {
    APP_NAME: "deployment",
    REMOTE_CALL_TIMEOUT: 120e3,
    METHOD_PARAMS_SCHEMA,
    APP_ID: 1,

    readOnlyMethods: ["init", 'undeploy'],

    init: async function(params) {
        return this.callPlugin("system", "initializeDeploymentKey")
    },

    undeploy: async function (params) {
        const {
            params: {app}
        } = params

        await this.callPlugin("system", "undeployApp", app);

        return {
            success: true,
        }
    },

    selectPartyNodes: async function(request) {
        let {
            method,
            data: { params }
        } = request
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

        let prevContext;
        if(method === Methods.TssRotate) {
            prevContext = await this.callPlugin("system", "getAppContext", appId, previousSeed);
            if (!prevContext)
                throw {message: `App previous context missing on deployment onArrive method`, appId, seed};

            /** threshold will not change when rotating the party */
            t = prevContext.party.t
        }

        /** Choose a few nodes at random to join the party */
        let selectedNodes;
        if(!!nodes) {
            selectedNodes = nodes
        }
        else {
            selectedNodes = await this.callPlugin("system", "selectRandomNodes", seed, t, n);
            selectedNodes = selectedNodes.map(({id}) => id)
        }

        if(method === Methods.TssRotate) {
            let countToKeep = Math.ceil(t * ROTATION_COEFFICIENT);
            let previousNodes = prevContext.party.partners
            if(!!prevContext.keyGenRequest?.data?.init?.shareProofs) {
                const nodesWithProof = Object.keys(prevContext.keyGenRequest?.data?.init?.shareProofs);
                if(nodesWithProof.length < countToKeep) {
                    /** select all nodes with proof and add some other random nodes */
                    selectedNodes = [...nodesWithProof, ...selectedNodes];
                    previousNodes = prevContext.party.partners.filter(id => !nodesWithProof.includes(id))
                    countToKeep -= nodesWithProof.length
                }
                else{
                    previousNodes = nodesWithProof;
                }
            }
            /** Pick some nodes to retain in the new party */
            const nodesToKeep = shuffleNodes(previousNodes, seed).slice(0, countToKeep)
            /** Merge nodes and retain n nodes */
            selectedNodes = lodash.uniq([...nodesToKeep, ...selectedNodes]).slice(0, n);
        }
        return selectedNodes;
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
                } = params
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
                    leaderSignature,
                } = params

                const oldContext = await this.callPlugin('system', "getAppContext", appId, previousSeed)

                if(!oldContext)
                    throw `App previous context not found on the deployment app's validateRequest method`

                const reshareLeader = await this.callPlugin('system', "getReshareLeader")
                if(!reshareLeader)
                    throw `There is no leader to rotate app party.`

                const caller = ecRecover(seed, leaderSignature);
                if(reshareLeader.wallet !== caller)
                    throw `Only the leader can rotate the app's party.`

                /** Most recent status of App should be PENDING (about to expire) */
                const {status, hasKeyGenRequest} = this.callPlugin('system', "getAppDeploymentInfo", appId, previousSeed)

                if(!hasKeyGenRequest)
                    throw `App tss key not reshared. call reshare before.`
                if(status !== 'PENDING' && status !== 'EXPIRED')
                    throw `Previous context status is not PENDING/EXPIRED. It is ${status}`

                await this.validateSeed(request, seed, reqId, nonce);
                break
            }
            case Methods.TssReshare: {
                const {appId, seed, leaderSignature} = params

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

                const reshareLeader = await this.callPlugin('system', "getReshareLeader")
                if(!reshareLeader)
                    throw `There is no leader to reshare the app's tss.`

                const caller = ecRecover(seed, leaderSignature);
                if(reshareLeader.wallet !== caller)
                    throw `Only the leader can reshare the app's tss key.`

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
                const selectedNodes = await this.selectPartyNodes(request);
                return {
                    selectedNodes,
                }
            }
            case Methods.TssKeyGen: {
                const { appId, seed } = params

                const {id, publicKey, generators, shareProofs} = await this.callPlugin('system', "generateAppTss", appId, seed)

                let context = await this.callPlugin('system', "getAppContext", appId, seed, true)

                return {
                    id,
                    publicKey,
                    partners: context.party.partners,
                    keyGenerators: generators,
                    shareProofs,
                }
            }
            case Methods.TssReshare: {
                const { appId, seed } = params

                /** ensure app context to be exist */
                let context = await this.callPlugin('system', "getAppContext", appId, seed, true)

                const {id, publicKey, generators, shareProofs} = await this.callPlugin('system', "reshareAppTss", appId, seed)

                return {
                    id,
                    publicKey,
                    partners: context.party.partners,
                    keyGenerators: generators,
                    shareProofs
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

                /** check selected nodes */

                let selectedNodes2 = await this.selectPartyNodes(request);

                let difference = symmetricDifference(selectedNodes, selectedNodes2).length / selectedNodes2.length
                if(difference > NODES_SELECTION_TOLERANCE)
                    throw `selected nodes mismatched.`

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
                const {selectedNodes} = init
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

                /** check selected nodes */

                let selectedNodes2 = await this.selectPartyNodes(request);

                let difference = symmetricDifference(selectedNodes, selectedNodes2).length / selectedNodes2.length
                if(difference > NODES_SELECTION_TOLERANCE)
                    throw `selected nodes mismatched.`

                const ttl = !!userDefinedTTL ? userDefinedTTL : prevContext.ttl;
                const pendingPeriod = !!pending ? pending : prevContext.pendingPeriod;

                /** TSS threshold will not change when rotating the app party */
                t = prevContext.party.t;

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

                const {ttl, pendingPeriod} = context;

                if(context.party.partners.join(',') !== request.data.init.partners.join(',')) {
                    throw `deployed partners mismatched with key-gen partners`
                }

                /** ensure a random key already generated */
                let publicKey, polynomial;
                if(method === Methods.TssKeyGen) {
                    const tssPublicInfo = await this.callPlugin('system', "findAndGetAppTssPublicInfo", appId, seed, init.id);
                    ({publicKey, polynomial}=tssPublicInfo)
                }
                else {
                    const oldContext = await this.callPlugin("system", "getAppContext", appId, context.previousSeed, true)
                    publicKey = oldContext.publicKey;
                    const tssPublicInfo = await this.callPlugin('system', "findAndGetAppTssPublicInfo", appId, seed, init.id);
                    polynomial = tssPublicInfo.polynomial
                }

                if(!publicKey)
                    throw `App new tss key not found`;

                const shareProofsIsValid = await this.callPlugin(
                  "system",
                  "validateShareProofs",
                  polynomial.Fx,
                  init.shareProofs
                );
                if(!shareProofsIsValid) {
                    throw `error in validating share proofs.`
                }
                if(Object.keys(init.shareProofs).length < polynomial.t)
                    throw `Insufficient share holder.`

                return {
                    rotationEnabled: true,
                    ttl,
                    expiration: request.data.timestamp + ttl + pendingPeriod,
                    seed: context.seed,
                    publicKey,
                    polynomial,
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
                    ...result.selectedNodes.map(v => ({t: 'uint64', v})),
                ]
            }
            case Methods.TssKeyGen:
            case Methods.TssReshare: {
                const {appId} = request.data.params
                let polynomialParams = []
                if(result.polynomial) {
                    polynomialParams = result.polynomial.Fx.map(v => ({t: 'bytes',v}))
                }
                return [
                    {t: "bool", v: request.data.result.rotationEnabled},
                    {t: "uint64", v: request.data.result.ttl},
                    {t: "uint64", v: request.data.result.expiration},
                    {t: "string", v: request.data.result.seed},
                    {t: 'address', v:request.data.result.publicKey.address},
                    ...polynomialParams,
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
