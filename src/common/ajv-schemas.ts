export const MuonNodeInfoSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      customType: "decimal",
      errorMessage: {
        type: "nodeId must be a valid decimal number",
        customType: "NodeId must be a decimal number"
      }
    },
    active: {type: "boolean"},
    staker: {
      type: 'string',
      customType: "ethAddress",
      errorMessage: {
        type: "staker address must be a valid ethereum address.",
        customType: "staker address must be a valid ethereum address."
      }
    },
    wallet: {
      type: 'string',
      customType: "ethAddress",
      errorMessage: {
        type: "wallet address must be a valid ethereum address.",
        customType: "wallet address must be a valid ethereum address."
      }
    },
    peerId: {
      type: "string",
      customType: "peerId",
    },
    isDeployer: {"type": "boolean"}
  },
  required: ["id", "active", "staker", "wallet", "peerId", "isDeployer"]
}

export const NodeManagerDataSchema = {
  type: "object",
  properties: {
    lastUpdateTime: {
      type: "number"
    },
    nodes: {
      type: "array",
      items: MuonNodeInfoSchema,
      errorMessage: {
        type: "nodes must be array of MuonNodeInfo",
      }
    }
  },
  required: ["lastUpdateTime", "nodes"]
}

export const MuonSignatureSchema = {
  type: "object",
  properties: {
    owner: {customType: "ethAddress"},
    ownerPublicKey: {
      x: {customType: "uint256"},
      yParity: {
        enum: ['0', '1']
      },
    },
    signature: {
      type: "array",
      items: {customType: "uint256"}
    },
  },
  required: ["owner", "ownerPublicKey", "signatures"]
}

export const AppRequestSchema = {
  type: "object",
  properties: {
    confirmed: {type: "boolean"},
    reqId: {type: "string"},
    app: {type: "string"},
    appId: {type: "string"},
    method: {type: "string"},
    deploymentSeed: {type: "string"},
    gwAddress: {customType: "ethAddress"},
    data: {
      type: "object",
      properties: {
        uid: {type: "string"},
        // params: any,
        timestamp: {customType: "epoch"},
        // result: any,
        resultHash: {customType: "uint256"},
        // signParams: TypedValue[],
        init: {
          type: "object",
          properties: {
            nonceAddress: {customType: "ethAddress"},
          },
          require: ["nonceAddress"],
        },
        fee: {
          type: "object",
          properties: {
            amount: {type: "number"},
            spender: {
              type: "object",
              properties:{
                address: {customType: "ethAddress"},
                timestamp: {customType: "epoch"},
                signature: {customType: "ethSignature"},
              },
              required: ["address", "timestamp", "signature"],
            },
            signature: {customType: "ethSignature"},
          },
          required: ["amount", "spender", "signature"]
        }
      },
      required: ["uid", "timestamp", "resultHash"]
    },
    startedAt: {customType: "epoch"},
    confirmedAt: {customType: "epoch"},
    signatures: {
      type: "array",
      item: MuonSignatureSchema
    },
  },
  required: ["reqId", "app", "appId", "method", "deploymentSeed", "data"]
}

export const PartySchema = {
  type: "object",
  properties: {
    appId: {customType: "hex"},
    seed: {customType: "hex"},
    t: {type: "number"},
    max: {type: "number"},
    partners: {
      type: "array",
      items: {type: "string"},
      minItems: 2,
    }
  },
  required: ["appId", "seed", "t", "partners"]
}

export const JsonPublicKeySchema = {
  type: "object",
  properties: {
    address: {customType: "ethAddress"},
    encoded: {customType: "ecPoint"},
    x: {cystomType: "uint256"},
    yParity: {type: "string", enum: ["0", "1"]},
  },
  required: ["x", "yParity"],
}

export const PolynomialInfoJsonSchema = {
  type: "object",
  properties: {
    t: {type: "number", minimum: 2},
    Fx: {
      type: "array",
      items: {customType: "ecPoint"},
      minItems: 2
    }
  },
  required: ["t", "Fx"],
}

export const AppContextSchema = {
  type: "object",
  properties: {
    appId: {customType: "hex"},
    appName: {type: "string"},
    previusSeed: {customType: "hex"},
    seed: {customType: "hex"},
    party: {
      type: "object",
      properties: {
        t: {type: "number", minimum: 2},
        max: {type: "number", minimum: 2},
        partners: {
          type: "array",
          items: {type: "string"},
          minItems: 2
        }
      },
      required: ["t", "partners"]
    },
    rotationEnabled: {type: "boolean"},
    ttl: {type: "number"},
    pendingPeriod: {type: "number"},
    expiration: {type: "number"},
    deploymentRequest: AppRequestSchema,
    keyGenRequest: AppRequestSchema,
    publicKey: JsonPublicKeySchema,
    polynomial: PolynomialInfoJsonSchema,
  },
  required: ["appId", "appName", "seed", "party", "rotationEnabled"]
}
