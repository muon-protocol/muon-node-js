import Ajv, {_,KeywordDefinition, KeywordErrorDefinition, KeywordCxt} from 'ajv'
import ajvErrors from 'ajv-errors';
import {peerIdFromString} from "@libp2p/peer-id";

function isPeerId(input: string): boolean {
  try {
    peerIdFromString(input)
    return true;
  } catch (e) {
    return false
  }
}

function isHex(input: string): boolean {
  return /^(0x|0X)?[0-9A-Fa-f]+$/.test(input);
}

function isDecimal(input: string): boolean {
  return /^[1-9][0-9]*$/.test(input)
}

function isEthAddress(input: string): boolean {
  return /^0x[0-9A-Fa-f]{40}$/.test(input)
}

function isUint32(input: string): boolean {
  return /^0x[0-9A-Fa-f]{1,64}$/.test(input)
}

const rangeKeywork: KeywordDefinition = {
  keyword: "range",
  type: "number",
  compile([min, max], parentSchema) {
    return parentSchema.exclusiveRange === true
      ? (data) => data > min && data < max
      : (data) => data >= min && data <= max
  },
  errors: false,
  metaSchema: {
    type: "array",
    items: [{type: "number"}, {type: "number"}],
    minItems: 2,
    additionalItems: false,
  },
}

const customType: KeywordDefinition = {
  keyword: "customType",
  type: "string",
  compile: (t, parentSchema) => {
    return input => {
      switch (t) {
        case "peerId":
          return isPeerId(input);
        case "hex":
          return isHex(input);
        case "decimal":
          return isDecimal(input);
        case "ethereumAddress":
          return isEthAddress(input);
        case "uint32":
          return isUint32(input);
        default:
          return false;
      }
    }
  },
  errors: true,
  error: {
    message: function (ctx: KeywordCxt) {
      const {data, schema} = ctx;
      return `custom type ${schema} validation failed`
    },
    params: (ctx: KeywordCxt) => {
      const {schema} = ctx
      return _`{customType: ${schema}}`
    }
  } as KeywordErrorDefinition,
  metaSchema: {
    type: "string",
    enum: ["peerId", "hex", "decimal", "ethereumAddress", "uint32"],
  },
}

export function createAjv(): Ajv {
  const ajv = new Ajv({strict: false, allErrors: true})
  ajvErrors(ajv);

  ajv.addKeyword(rangeKeywork);
  ajv.addKeyword(customType);

  return ajv
}
