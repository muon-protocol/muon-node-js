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
      x: {customType: "uint32"},
      yParity: {
        enum: ['0', '1']
      },
    },
    signature: {
      type: "array",
      items: {customType: "uint32"}
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
        timestamp: {type: "number"},
        // result: any,
        resultHash: {customType: "uint32"},
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
            amount: {customType: "bn"},
            spender: {
              type: "object",
              properties: {
                address: {customType: "ethAddress"},
                timestamp: {type: "number"},
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
    startedAt: {type: "number"},
    confirmedAt: {type: "number"},
    signatures: {
      type: "array",
      item: MuonSignatureSchema
    },
  },
  required: ["reqId", "app", "appId", "method", "deploymentSeed", "data"]
}
