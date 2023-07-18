import TronWeb from 'tronweb'
import Web3 from 'web3'
import {muonSha3} from './sha3.js'

const web3 = new Web3('http://localhost:8545');
// console.log(TronWeb.utils)

const ADDRESS_PREFIX_REGEX = /^(41)/;
const ADDRESS_PREFIX = "41";

function encodeParams(inputs){
  let typesValues = inputs
  let parameters = ''

  if (typesValues.length == 0)
    return parameters

  let types = [];
  const values = [];

  for (let i = 0; i < typesValues.length; i++) {
    let {type, value} = typesValues[i];
    if (type == 'address')
      value = value.replace(ADDRESS_PREFIX_REGEX, '0x');
    else if (type == 'address[]')
      value = value.map(v => toHex(v).replace(ADDRESS_PREFIX_REGEX, '0x'));
    types.push(type);
    values.push(value);
  }

  // console.log(types, values)
  try {
    parameters = web3.eth.abi.encodeParameters(types, values).replace(/^(0x)/, '');
  } catch (ex) {
    console.log(ex);
  }
  return parameters

}

/**
 types:Parameter type list, if the function has multiple return values, the order of the types in the list should conform to the defined order
 output: Data before decoding
 ignoreMethodHash：Decode the function return value, fill falseMethodHash with false, if decode the data field in the gettransactionbyid result, fill ignoreMethodHash with true

 Sample: await decodeParams(['address', 'uint256'], data, true)
 */

async function decodeParams(types, output, ignoreMethodHash) {

  if (!output || typeof output === 'boolean') {
    ignoreMethodHash = output;
    output = types;
  }

  if (ignoreMethodHash && output.replace(/^0x/, '').length % 64 === 8)
    output = '0x' + output.replace(/^0x/, '').substring(8);


  if (output.replace(/^0x/, '').length % 64)
    throw new Error('The encoded string is not valid. Its length must be a multiple of 64.');

  return Object.values(web3.eth.abi.decodeParameters(types, output)).reduce((obj, arg, index) => {
    if (index >= types.length)
      return obj;
    if (types[index] == 'address')
      arg = ADDRESS_PREFIX + arg.substr(2).toLowerCase();
    obj.push(arg);
    return obj;
  }, []);
}

function encodeSignature(signature, owner, nonce) {
  return "0x" + encodeParams([
    {type: "uint256", value: signature},
    {type: "uint256", value: owner},
    {type: "address", value: nonce},
  ])
}

function toEthAddress(address) {
  if(Web3.utils.isAddress(address))
    return address;
  if(!TronWeb.utils.crypto.isAddressValid(address))
    throw {message: `Invalid tron or eth address ${address}`}
  if(!TronWeb.utils.isHex(address))
    return Web3.utils.toChecksumAddress("0x" + TronWeb.address.toHex(address).substr(2, 40));
  else
    return address;
}

function soliditySha3(inputs) {
  inputs = inputs.map(({type, value}) => {
    if(type === 'address')
      return {type, value: toEthAddress(value)}
    else
      return {type, value}
  })
  return muonSha3(...inputs)
}

export {
  TronWeb,
  soliditySha3,
  encodeParams,
  toEthAddress,
  decodeParams,
  encodeSignature,
};
