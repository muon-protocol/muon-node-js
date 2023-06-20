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
      customType: "ethereumAddress",
      errorMessage: {
        type: "staker address must be a valid ethereum address.",
        customType: "staker address must be a valid ethereum address."
      }
    },
    wallet: {
      type: 'string',
      customType: "ethereumAddress",
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
