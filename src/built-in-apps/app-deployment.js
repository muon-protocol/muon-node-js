const {
    lodash,
    muonSha3,
    ecRecover,
} = MuonAppUtils

const Methods = {
    Check: "check",
    RandomSeed: "random-seed",
    Deploy: "deploy",
    Reshare: "reshare"
}

const NODES_SELECTION_TOLERANCE = 0.07;
const ROTATION_COEFFICIENT = 1.5;
const DEPLOYMENT_APP_ID = "1"

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

const uint256Schema = {
    type: 'string',
    customType: "uint256"
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
        value: uint256Schema,
        reqId: uint256Schema,
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
          previousSeed: uint256Schema
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
    [Methods.Reshare]: {
        type: "object",
        properties: {
            appId: appIdSchema,
            seed: verifiableSeedSchema,
            previousSeed: uint256Schema,
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
    }
}

module.exports = {
    APP_NAME: "deployment",
    REMOTE_CALL_TIMEOUT: 120e3,
    METHOD_PARAMS_SCHEMA,
    APP_ID: "1",

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

        if(appId === DEPLOYMENT_APP_ID)
            return this.callPlugin("system", "getAvailableDeployers");

        t = Math.max(t, tssConfigs.threshold);

        let prevContext;
        if(method === Methods.Reshare) {
            prevContext = await this.callPlugin("system", "getAppContext", appId, previousSeed);
            if (!prevContext)
                throw {message: `App previous context missing on deployment onArrive method`, appId, seed};

            /** threshold will not change when rotating the party */
            t = appId === DEPLOYMENT_APP_ID ? tssConfigs.thresholds : prevContext.party.t
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

        if(method === Methods.Reshare) {
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

    getDeploymentParams: async function(request) {
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
            ttl: userDefinedTTL,
            pendingPeriod: userDefinedPending,
        } = params

        let ttl = !!userDefinedTTL ? userDefinedTTL : await this.callPlugin("system", "getAppTTL", appId);
        let pendingPeriod = !!userDefinedPending ? userDefinedPending : tssConfigs.pendingPeriod

        t = Math.max(t, tssConfigs.threshold);
        if(method === Methods.Reshare) {
            const prevContext = await this.callPlugin("system", "getAppContext", appId, previousSeed);
            if (!prevContext)
                throw {message: `App previous context missing on deployment onArrive method`, appId, seed};

            if(appId === DEPLOYMENT_APP_ID) {
                t = tssConfigs.threshold;
            }
            else{
                t = prevContext.party.t;
            }

            ttl = !!userDefinedTTL ? userDefinedTTL : prevContext.ttl;
            pendingPeriod = !!userDefinedPending ? userDefinedPending : prevContext.pendingPeriod;
        }
        const expiration = request.data.timestamp + ttl + pendingPeriod;

        return {t, n, ttl, pendingPeriod, expiration}
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
      if(!await this.verify(request.deploymentSeed, hash, seed, nonce))
        throw `seed not verified`
    },

    validateRequest: async function(request) {
        let {
            method,
            deploymentSeed,
            data: { params }
        } = request

        if(params.appId !== DEPLOYMENT_APP_ID && deploymentSeed === "0x01")
          throw `The genesis key only will be used for deploying 'deployment' app itself.`

        switch (method) {
            case Methods.RandomSeed: {
                const {appId} = params
                const {deployed, status, seed} = this.callPlugin('system', "getAppLastDeploymentInfo", appId)
                /** ignore deployment genesis context */
                if(deployed && status !== 'PENDING' && seed !== '0x01')
                    throw `App already deployed`
                break;
            }
            case Methods.Deploy: {
                const {
                    appId,
                    seed: {value: seed, nonce, reqId},
                } = params
                const context = await this.callPlugin('system', "getAppContext", appId, seed)
                /** ignore onboarding contexts */
                if(!!context && !!context.deploymentRequest) {
                    throw {message: `App already deployed`, context};
                }
                await this.validateSeed(request, seed, reqId, nonce);
                break;
            }
            case Methods.Reshare: {
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
                    throw `There is no leader to resahre the app.`

                const caller = ecRecover(seed, leaderSignature);
                if(reshareLeader.wallet !== caller)
                    throw `Only the leader can rotate the app's party.`

                /** Most recent status of App should be PENDING (about to expire) */
                const {status, hasKeyGenRequest} = this.callPlugin('system', "getAppDeploymentInfo", appId, previousSeed)

                if(status !== 'PENDING' && status !== 'EXPIRED')
                    throw `Previous context status is not PENDING/EXPIRED. It is ${status}`

                await this.validateSeed(request, seed, reqId, nonce);
                break
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
            case Methods.Reshare: {
                const { 
                    appId, 
                    previousSeed,
                    seed: {value: seed}, 
                } = params

                const {t, n, ttl, pendingPeriod, expiration} = await this.getDeploymentParams(request);
                const selectedNodes = await this.selectPartyNodes(request);

                /** initialize new context on the app partners. */
                await this.callPlugin("system", "initDeploymentContext", {
                    appId,
                    appName: "", 
                    previousSeed,
                    seed,
                    isBuiltIn: false,
                    party: { 
                        t, 
                        max: n,
                        partners: selectedNodes
                    },
                    rotationEnabled: true,
                    ttl,
                    pendingPeriod,
                    expiration,
                });

                const {id, publicKey, polynomial, generators, shareProofs} = (
                    method === Methods.Deploy
                    ?
                    await this.callPlugin('system', "generateAppTss", appId, seed)
                    :
                    await this.callPlugin('system', "reshareAppTss", appId, seed)
                )

                return {
                    key: {id, publicKey, polynomial, generators, shareProofs},
                    selectedNodes,
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
            case Methods.Deploy:
            case Methods.Reshare: {
                const {selectedNodes, key} = init
                let {
                    appId,
                    previousSeed,
                    seed: {value: seed},
                } = params

                const {t, n, ttl, pendingPeriod, expiration} = await this.getDeploymentParams(request);

                /** check selected nodes */

                let selectedNodes2 = await this.selectPartyNodes(request);

                let difference = symmetricDifference(selectedNodes, selectedNodes2).length / selectedNodes2.length

                if(difference > NODES_SELECTION_TOLERANCE)
                    throw `selected nodes mismatched.`

                /** ensure a random key already generated */
                let publicKey, polynomial;
                const tssPublicInfo = await this.callPlugin('system', "findAndGetAppTssPublicInfo", appId, seed, init.key.id);
                ({publicKey, polynomial}=tssPublicInfo)

                if(method === Methods.Reshare) {                
                    const oldContext = await this.callPlugin("system", "getAppContext", appId, previousSeed, true)
                    if(oldContext.publicKey.encoded != publicKey.encoded)
                        throw `App's signing public key changed throgh the reshare.`;
                }

                const shareProofsIsValid = await this.callPlugin(
                  "system",
                  "validateShareProofs",
                  polynomial.Fx,
                  init.key.shareProofs
                );
                if(!shareProofsIsValid) {
                    throw `error in validating share proofs.`
                }
                if(Object.keys(init.key.shareProofs).length < polynomial.t)
                    throw `Insufficient share holder.`

                return {
                    rotationEnabled: true,
                    ttl,
                    pendingPeriod,
                    expiration,
                    timestamp: request.data.timestamp,
                    previousSeed,
                    seed,
                    tssThreshold: t,
                    maxGroupSize: n,
                    selectedNodes,
                    publicKey,
                    polynomial,
                    // publicKey: key.publicKey,
                    // polynomial: key.polynomial,
                };
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
            case Methods.Reshare: {
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
                    {t: 'address', v:result.publicKey.address},
                    ...result.polynomial.Fx.map(v => ({t: 'bytes',v})),
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
            case Methods.Reshare: {
                const {appId, seed: {value: seed}} = params
                
                const newContext = await this.callPlugin("system", "getAppContext", appId, seed, true);
                if(!newContext)
                    throw {message: `Onboarding context not found.`, appId, seed}
                
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
            case Methods.Reshare: {
                let success = await this.callPlugin(
                    "system",
                    "appDeploymentConfirmed",
                    request, 
                    result
                )
                if(!success)
                    throw "Fail to store app context."
                break;
            }
        }
    }
}
