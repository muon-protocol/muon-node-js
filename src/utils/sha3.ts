import Web3 from 'web3'
import {createHash, Encoding} from "node:crypto";
const web3Instance = new Web3()

export function soliditySha3(params) {
    return web3Instance.utils.soliditySha3(...params)
}

export function nodeSha3(input: string|Buffer, inputType?: Encoding) {
    if(typeof input === 'string' && !!inputType)
        return '0x' + createHash('sha3-256').update(input, inputType).digest('hex')
    else
        return '0x' + createHash('sha3-256').update(input).digest('hex')
}

export function muonSha3(...args): string {
    const packed:string = web3Instance.utils.encodePacked(...args)!;
    if(!packed)
        throw `muonSha3 error: unknown input data`
    return nodeSha3(packed, 'hex')
}
