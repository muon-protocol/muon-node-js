import Ajv from 'ajv';
import * as TssModule from "../../utils/tss/index.js";
const ajv = new Ajv()
ajv.addKeyword({
  keyword: 'validate',
  validate: (schema, data, parentSchema, dataContext) => {
    return schema(data, parentSchema, dataContext);
  }
})

const pattern_id = "^[1-9][0-9]*$";

const schema_uint32 = {type: 'string', pattern: `^0x[0-9A-Fa-f]{64}$`};

const schema_public_key = {
  type: 'string',
  validate: str => {
    /** check to be valid encoded publicKey string */
    if(!/^(((02|03)[0-9A-Fa-f]{64})|((04)[0-9A-Fa-f]{128}))$/.test(str))
      return false

    /** check to be on the elliptic curve */
    try {
      let point = TssModule.keyFromPublic(str);
      return TssModule.validatePublicKey(point)
    }catch (e) {
      return false;
    }
  }
};

const InputSchema = {
  'round1': {
    type: 'object',
    properties: {
      broadcast: {
        type: 'object',
        properties: {
          Fx: {
            type: 'array',
            items: schema_public_key
          },
          sig: {
            type: 'object',
            properties:{
              nonce: schema_public_key,
              signature: {type: "string"},
            },
            required:['nonce', 'signature']
          }
        },
        required: ["Fx", "sig"]
      },
    },
    required: ['broadcast']
  },
  'round2':{
    type: 'object',
    properties: {
      send: {
        type: 'object',
        properties: {
          f: schema_uint32,
        },
        required: ['f']
      },
      broadcast: {
        type: "object",
        properties: {
          allPartiesFxHash: {
            type: 'object',
            patternProperties: {
              [pattern_id]: schema_uint32
            }
          }
        },
        required: ['allPartiesFxHash']
      }
    },
    required: ['send', 'broadcast']
  },
  'round3': {
    type: 'object',
    properties: {
      broadcast: {
        type: 'object',
        properties: {
          malicious: {
            type: 'array',
            items: {type: 'string'},
          }
        },
        required: ['malicious'],
      },
    },
    required: ['broadcast'],
  }
}

const validations = Object.entries(InputSchema)
  .map(([round, schema]) => {
    return [
      round,
      ajv.compile(schema),
    ]
  })
  // @ts-ignore
  .reduce((obj, [round, validation], i) => (obj[round]=validation, obj), {})


export default validations;
