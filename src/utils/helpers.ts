import fs from 'fs'
import readline from 'readline'
import numberToBN from  'number-to-bn'
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {PublicKey} from "./tss/types.js";
import {pub2addr} from "./tss/utils.js";
import {AppDeploymentStatus, JsonPublicKey} from "../common/types";
import {promisify} from 'util'
import childProcess from 'node:child_process'
import {isIP} from 'net'
import isIpPrivate from 'private-ip'
import {loadGlobalConfigs} from "../common/configurations.js";
import BN from "bn.js";
import { APP_STATUS_DEPLOYED, APP_STATUS_EXPIRED, APP_STATUS_NEW, APP_STATUS_ONBOARDING, APP_STATUS_PENDING } from '../core/constants.js';


const exec = promisify(childProcess.exec);

export const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const getTimestamp = () => Math.floor(Date.now() / 1000);
export const uuid = () => {
  return Date.now().toString(32) + Math.floor(Math.random()*999999999).toString(32);
}
export const sortObject = o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {})

export const floatToBN = (floatNumber, decimals) => {
  const floatString = floatNumber.toString();
  const [integerPart, decimalPart = ''] = floatString.split('.');
  let bnValue = new BN(integerPart);
  const decimalPartTruncated = decimalPart.slice(0, decimals);
  const paddingZeros = '0'.repeat(decimals - decimalPartTruncated.length);
  const decimalPartCombined = decimalPartTruncated + paddingZeros;
  const decimalBN = new BN(decimalPartCombined);
  bnValue = bnValue.mul(new BN(10).pow(new BN(decimals))).add(decimalBN);
  return toBN(bnValue.toString());
}


export const parseBool = v => {
  if(typeof v === 'string')
    v = v.toLowerCase();
  return v === '1' || v==='true' || v === true || v === 1;
}



export const flattenObject = (obj, prefix="") => {
  let result = {}
  if(Array.isArray(obj)){
    for(let i=0 ; i<obj.length ; i++){
      let newKey = !!prefix ? `${prefix}[${i}]` : `[${i}]`
      result = {
        ...result,
        ...flattenObject(obj[i], newKey)
      }
    }
  }
  else if(typeof obj === 'object' && obj !== null){
    for(let key of Object.keys(obj)){
      let newKey = !!prefix ? `${prefix}.${key}` : key
      result = {
        ...result,
        ...flattenObject(obj[key], newKey)
      }
    }
  }
  else{
    return !!prefix ? {[prefix]: obj} : obj
  }
  return result
}

// https://stackoverflow.com/questions/28222228/javascript-es6-test-for-arrow-function-built-in-function-regular-function
export const isArrowFn = (fn) => (typeof fn === 'function') && !/^(?:(?:\/\*[^(?:\*\/)]*\*\/\s*)|(?:\/\/[^\r\n]*))*\s*(?:(?:(?:async\s(?:(?:\/\*[^(?:\*\/)]*\*\/\s*)|(?:\/\/[^\r\n]*))*\s*)?function|class)(?:\s|(?:(?:\/\*[^(?:\*\/)]*\*\/\s*)|(?:\/\/[^\r\n]*))*)|(?:[_$\w][\w0-9_$]*\s*(?:\/\*[^(?:\*\/)]*\*\/\s*)*\s*\()|(?:\[\s*(?:\/\*[^(?:\*\/)]*\*\/\s*)*\s*(?:(?:['][^']+['])|(?:["][^"]+["]))\s*(?:\/\*[^(?:\*\/)]*\*\/\s*)*\s*\]\())/.test(fn.toString());

export const deepFreeze = function deepFreeze (object) {
  // Retrieve the property names defined on object
  const propNames = Object.getOwnPropertyNames(object);

  // Freeze properties before freezing self

  for (const name of propNames) {
    const value = object[name];

    if (value && typeof value === "object") {
      deepFreeze(value);
    }
  }

  return Object.freeze(object);
}

export const stackTrace = function() {
  let err = new Error();
  return err.stack;
}

export async function readFileTail(path: string, n: number): Promise<string> {
  const fileStream = fs.createReadStream(path);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: 1
  });

  const lines: string[] = []
  for await (const line of rl) {
    lines.push(line)
    if(lines.length > n)
      lines.splice(0, 1)
  }

  return lines.join('\n');
}

export function filePathInfo(importMeta) {
  const __filename = fileURLToPath(importMeta.url);
  const __dirname = dirname(__filename);

  return {__filename, __dirname};
}

export function pub2json(pubkey: PublicKey, minimal: boolean=false): JsonPublicKey {
  let extra = minimal ? {} : {
    address: pub2addr(pubkey),
    encoded: pubkey.encode('hex', true),
  }
  return {
    ...extra,
    x: '0x' + pubkey.getX().toBuffer('be', 32).toString('hex'),
    yParity: pubkey.getY().mod(toBN(2)).toString(),
  }
}

export async function findMyIp(): Promise<string|undefined> {

  const checkValidIp = str => {
    if(!isIP(str))
      throw `input is not ip`
    if(isIpPrivate(str))
      throw `input is private ip`
    return str
  };

  const envIp = process.env.PUBLIC_IP;
  if (envIp)
    return envIp!;

  let configs = loadGlobalConfigs('net.conf.json', 'default.net.conf.json');
  let ifconfigURLs = configs.routing.ifconfig;
  if(!ifconfigURLs || !Array.isArray(ifconfigURLs) || ifconfigURLs.length===0)
    return undefined;

  // @ts-ignore
  let ip = await Promise.any(ifconfigURLs.map(ifconfigURL => {
      return axios.get(ifconfigURL)
        .then(({data}) => {
          return data.ip_addr;
        })
        .then(checkValidIp)
    })
  );

  return ip;
}

export async function getCommitId(): Promise<string> {
  const {stdout, stderr} = await exec('git rev-parse HEAD');
  if(stderr)
    throw stderr;
  return stdout.trim();
}

export function statusCodeToTitle(code: number): AppDeploymentStatus {
  return [
    APP_STATUS_NEW, 
    APP_STATUS_ONBOARDING, 
    APP_STATUS_DEPLOYED, 
    APP_STATUS_PENDING, 
    APP_STATUS_EXPIRED
  ][code] as AppDeploymentStatus;
}

export function toBN(number) {
  try {
    return numberToBN.apply(null, arguments);
  }
  catch (e) {
    throw new Error(e + ' Given value: "' + number + '"');
  }
}
