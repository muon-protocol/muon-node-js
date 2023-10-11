import type { Multiaddr } from "@multiformats/multiaddr";
import isIpPrivate from "private-ip";
import { PeerId } from "./types";
import * as eth from "../utils/eth.js";
import {logger} from '@libp2p/logger'
import {createRequire} from "module";
import {MuonNodeInfo, NodeManagerConfigs, NodeManagerData, NodeManagerDataRaw} from "../common/types";
import {peerIdFromString} from "@libp2p/peer-id";
import {timeout} from "../utils/helpers.js";
import { multiaddr } from "@multiformats/multiaddr";
import { createClient, RedisClient } from 'redis'
import redisConfig from '../common/redis-config.js'
import {promisify} from "util";
import {createAjv} from "../common/ajv.js";
import {NodeManagerDataSchema} from "../common/ajv-schemas.js";
import {MuonNodeRoles} from "../common/contantes.js";

const require = createRequire(import.meta.url);
const NodeManagerAbi = require('../data/NodeManager-ABI.json')
const log = logger('muon:network:utils')

const ajv = createAjv()

const redisClient = createClient(redisConfig);
redisClient.on("error", function(error) {
  log.error(`redisClient error`, error);
});
const redisSet = promisify(redisClient.set.bind(redisClient));
const redisGet = promisify(redisClient.get.bind(redisClient));
const redisExpire = promisify(redisClient.expire).bind(redisClient)

/**
 * This function checks if a given
 * multiaddress is private or not.
 */
export function isPrivate(ma: Multiaddr) {
  const { address } = ma.nodeAddress();
  return Boolean(isIpPrivate(address));
}

export function peerId2Str(peerId: PeerId): string {
  return peerId.toString();
}

export async function tryAndGetNodeManagerData(nodeManagerConfigs: NodeManagerConfigs): Promise<NodeManagerData> {
  do {
    try {
      const nodeManagerData = await getNodeManagerData(nodeManagerConfigs);
      await storeNodeManagerDataIntoCache(nodeManagerConfigs, nodeManagerData);
      return nodeManagerData
    }catch (e) {
      log('loading NodeManager data failed. %o', e)
      await timeout(Math.floor(Math.random()*1*60*1000)+5000)
    }
  }
  while(true)
}

function nodeManagerDataCacheKey(configs: NodeManagerConfigs) {
  return `muon-node-manager-data@${configs.address}`
}

function convertToCoreObject(item): MuonNodeInfo {
  // @ts-ignore
  const roles = item.roles.map(r => parseInt(r));
  const tier = parseInt(item.tier);
  return {
    id: BigInt(item.id).toString(),
    active: true,
    staker: item.stakerAddress,
    wallet: item.nodeAddress,
    peerId: item.peerId,
    // @ts-ignore
    tier,
    roles,
    isDeployer: tier == 4,
  }
}

export async function getNodeManagerDataFromCache(configs: NodeManagerConfigs): Promise<NodeManagerData> {
  const contractInfo = await getContractInfo(configs);
  let dataStr = await redisGet(nodeManagerDataCacheKey(configs));
  if(!dataStr)
    throw "cached data not found."
  let data: NodeManagerData = JSON.parse(dataStr) as NodeManagerData;
  if(!ajv.validate(NodeManagerDataSchema, data)) {
    // @ts-ignore
    throw ajv.errorsText(ajv.errors);
  }
  if(data.lastUpdateTime !== contractInfo.lastUpdateTime)
    throw `cache data expired`;
  return data;
}

export async function storeNodeManagerDataIntoCache(configs: NodeManagerConfigs, data: NodeManagerData) {
  await redisSet(nodeManagerDataCacheKey(configs), JSON.stringify(data));
  /** keep in the cache for 36 hours */
  await redisExpire(nodeManagerDataCacheKey(configs), 36 * 60 * 60);
}

export async function getContractInfo(nodeManagerConfigs: NodeManagerConfigs, configNames: string[]=[]) {
  const {address, network} = nodeManagerConfigs;
  const {
    "0": lastUpdateTime,
    "1":lastNodeId,
    "2":lastRoleId,
    "3":configValues
  } = await eth.call(address, 'getInfo', [configNames], NodeManagerAbi, network);
  return {
    lastUpdateTime,
    lastNodeId,
    lastRoleId,
    ...configNames.reduce((obj, key, i) => (obj[key]=configValues[i], obj), {}),
  }
}

export async function getNodeManagerData(nodeManagerConfigs: NodeManagerConfigs): Promise<NodeManagerData> {
  const {address, network} = nodeManagerConfigs;

  const info = await getContractInfo(nodeManagerConfigs, []);
  let {lastNodeId, lastUpdateTime} = info;
  lastNodeId = parseInt(lastNodeId);
  lastUpdateTime = parseInt(lastUpdateTime);

  const itemPerPage = 150;
  const pagesToRequest = new Array(Math.ceil(lastNodeId / itemPerPage)).fill(0).map((_,i) => i)
  log(`loading NodeManager data: size: ${itemPerPage}, pages: [${pagesToRequest.join(',')}]`)

  const pagesData = await Promise.all(pagesToRequest.map(page => {
    const startIndex = page*itemPerPage + 1;
    const endIndex = Math.min(startIndex+itemPerPage-1, lastNodeId)
    return eth.call(
      address,
      'getAllNodes',
      ["0", `0x${startIndex.toString(16)}`,`0x${endIndex.toString(16)}`],
      NodeManagerAbi,
      network
    )
  }))
  let rawResult: NodeManagerDataRaw = [].concat(...pagesData);

  let exist = {};
  const nodes =rawResult
    .filter(item => {
      if (!item.active)
        return false;
      try {
        peerIdFromString(item.peerId)
        return true
      }
      catch (e) {
        return false;
      }
    })
    .map((item): MuonNodeInfo => convertToCoreObject(item))
    .filter(p => {
      if(exist[p.wallet] || exist[p.peerId])
        return false;

      exist[p.peerId] = true
      exist[p.wallet] = true

      return true
    })

  return {
    lastUpdateTime,
    nodes
  };
}

export async function tryAndGetNodeManagerChanges(nodeManagerConfigs: NodeManagerConfigs, fromTimestamp): Promise<NodeManagerData> {
  do {
    try {
      let data = await getNodeManagerChanges(nodeManagerConfigs, fromTimestamp)
      return data;
    }catch (e) {
      log('loading NetworkManager changes failed. %o', e)
      await timeout(5000)
    }
  }while(true)
}

export async function getNodeManagerChanges(nodeManagerConfigs: NodeManagerConfigs, fromTimestamp: number, count:number=100): Promise<NodeManagerData> {
  const {address, network} = nodeManagerConfigs;
  const changes = await eth.call(address, 'getEditedNodes', [fromTimestamp, 0, count], NodeManagerAbi, network)

  let lastUpdateTime = fromTimestamp;
  const nodes = changes.nodesList
    .map((item): MuonNodeInfo => {
      lastUpdateTime = Math.max(lastUpdateTime, parseInt(item.lastEditTime));
      return convertToCoreObject(item);
    })

  return {lastUpdateTime, nodes};
}

export function validateMultiaddrs(multiaddrs) {
  if (!multiaddrs)
    return false;
  if (!Array.isArray(multiaddrs))
    return false;
  if (multiaddrs.length === 0)
    return false;

  for (let i = 0; i < multiaddrs.length; i++) {
    try {
      multiaddr(multiaddrs[i]);
    } catch (e) {
      return false;
    }
  }
  return true;
}

export function validateTimestamp(timestamp, validPeriod) {
  let diff = Date.now() - timestamp;
  if (diff < 0)
    throw `Timestamp cannot be future time`;
  if (diff > validPeriod)
    throw `Timestamp is too old`;
}
