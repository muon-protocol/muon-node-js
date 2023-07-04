import Web3 from 'web3'
import jsSha3 from 'js-sha3'
const web3Instance = new Web3();

export function soliditySha3(params) {
  if (Array.isArray(params))
    return web3Instance.utils.soliditySha3(...params);
  else
    return web3Instance.utils.soliditySha3(params)
}

export function muonSha3(...args): string {
    const packed:string = web3Instance.utils.encodePacked(...args)!;
    if(!packed)
        throw `muonSha3 error: unknown input data`
  let buff = Buffer.from(packed.substring(2), 'hex');
  return '0x' + jsSha3.keccak_256(buff)
}
