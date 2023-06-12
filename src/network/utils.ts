import type { Multiaddr } from "@multiformats/multiaddr";
import isIpPrivate from "private-ip";
import { PeerId } from "./types";
import * as eth from "../utils/eth.js";
import {logger} from '@libp2p/logger'
import {createRequire} from "module";
import {MuonNodeInfo, NodeManagerConfigs, NodeManagerData, NodeManagerDataRaw} from "../common/types";
import {peerIdFromString} from "@libp2p/peer-id";
import {timeout} from "../utils/helpers.js";
import _ from "lodash";
import { multiaddr } from "@multiformats/multiaddr";

const require = createRequire(import.meta.url);
const NodeManagerAbi = require('../data/NodeManager-ABI.json')
const MuonNodesPaginationAbi = require('../data/MuonNodesPagination-ABI.json')
const log = logger('muon:network:utils')

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
      return nodeManagerData
    }catch (e) {
      log('loading NodeManager data failed. %o', e)
      await timeout(Math.floor(Math.random()*1*60*1000)+5000)
    }
  }
  while(true)
}

export async function getNodeManagerData(nodeManagerConfigs: NodeManagerConfigs): Promise<NodeManagerData> {
  const {address, network, pagination: paginationContractAddress} = nodeManagerConfigs;

  let rawResult: NodeManagerDataRaw;

  if(!!paginationContractAddress) {
    rawResult = await paginateAndGetNodeManagerData(
      paginationContractAddress,
      address,
      network
    )
  }
  else {
    rawResult = await eth.call(address, 'info', [], NodeManagerAbi, network)
  }

  let exist = {};
  const nodes =rawResult._nodes
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
    .map((item): MuonNodeInfo => ({
      id: BigInt(item.id).toString(),
      active: true,
      staker: item.stakerAddress,
      wallet: item.nodeAddress,
      peerId: item.peerId,
      isDeployer: item.isDeployer,
    }))
    .filter(p => {
      if(exist[p.wallet] || exist[p.peerId])
        return false;

      exist[p.peerId] = true
      exist[p.wallet] = true

      return true
    })

  return {
    lastUpdateTime: parseInt(rawResult._lastUpdateTime),
    nodes
  };
}
async function paginateAndGetNodeManagerData(paginationAddress:string, nodeManagerAddress: string, network: string): Promise<NodeManagerDataRaw> {
  const itemPerPage = 1200;
  const lastNodeIdStr: string = await eth.call(nodeManagerAddress, 'lastNodeId', [], NodeManagerAbi, network)
  const lastNodeId = parseInt(lastNodeIdStr)

  const pagesToRequest = new Array(Math.ceil(lastNodeId / itemPerPage)).fill(0).map((_,i) => i)
  log(`loading NodeManager data: size: ${itemPerPage}, pages: [${pagesToRequest.join(',')}]`)

  const pagesData = await Promise.all(pagesToRequest.map(page => {
    const startIndex = page*itemPerPage + 1;
    const endIndex = Math.min(startIndex+itemPerPage-1, lastNodeId)
    return eth.call(
      paginationAddress,
      'getAllNodes',
      [`0x${startIndex.toString(16)}`,`0x${endIndex.toString(16)}`],
      MuonNodesPaginationAbi,
      network
    )
  }))

  return {
    _lastUpdateTime: await eth.call(nodeManagerAddress, 'lastUpdateTime', [], NodeManagerAbi, network),
    _nodes: [].concat(...pagesData)
  }
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

export async function getNodeManagerChanges(nodeManagerConfigs: NodeManagerConfigs, fromTimestamp): Promise<NodeManagerData> {
  const {address, network, pagination: paginationContractAddress} = nodeManagerConfigs;

  let rawResult;
  if(!!paginationContractAddress) {
    rawResult = await paginateAndGetNodeManagerChanges(
      paginationContractAddress,
      address,
      network,
      fromTimestamp
    )
  }
  else {
    rawResult = await eth.call(address, 'info', [], NodeManagerAbi, network)
    rawResult._nodes = rawResult._nodes
      .filter(item => item.lastEditTime > fromTimestamp)
  }

  const nodes = rawResult._nodes
    .map((item): MuonNodeInfo => ({
      id: BigInt(item.id).toString(),
      active: item.active,
      staker: item.stakerAddress,
      wallet: item.nodeAddress,
      peerId: item.peerId,
      isDeployer: item.isDeployer,
    }))

  return {
    lastUpdateTime: parseInt(rawResult._lastUpdateTime),
    nodes
  };
}

async function paginateAndGetNodeManagerChanges(paginationAddress:string, nodeManagerAddress: string, network: string, timestamp: number): Promise<NodeManagerDataRaw> {
  const itemPerPage = 1200;
  const lastNodeId: number = parseInt(await eth.call(nodeManagerAddress, 'lastNodeId', [], NodeManagerAbi, network))

  const pagesToRequest = new Array(Math.ceil(lastNodeId / itemPerPage)).fill(0).map((_,i) => i)
  log(`loading node changes: size: ${itemPerPage}, pages: [${pagesToRequest.join(',')}]`)

  const pagesData = await Promise.all(pagesToRequest.map(page => {
    const startIndex = page*itemPerPage + 1;
    const endIndex = Math.min(startIndex+itemPerPage-1, lastNodeId)
    return eth.call(
      paginationAddress,
      'getEditedNodes',
      [
        `0x${timestamp.toString(16)}`,
        `0x${startIndex.toString(16)}`,
        `0x${endIndex.toString(16)}`
      ],
      MuonNodesPaginationAbi,
      network
    )
  }))

  // @ts-ignore
  const _nodes = [].concat(...pagesData).filter(node => parseInt(node.id)>0)

  return {
    // @ts-ignore
    _lastUpdateTime: _nodes.reduce((max, node) => Math.max(max, parseInt(node.lastEditTime)), 0),
    _nodes
  }
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