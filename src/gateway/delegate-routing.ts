import {Router} from 'express';
import * as NetworkIpc from '../network/ipc.js'
import {mixGetPost} from './middlewares.js'
import {logger} from '@libp2p/logger'
import {muonSha3} from "../utils/sha3.js";
import * as crypto from "../utils/crypto.js";
import {MuonNodeInfo} from "../common/types";
import asyncHandler from 'express-async-handler'

const router = Router();
const log = logger("muon:gateway:routing")

type RoutingData = {
  timestamp: number,
  id: string,
  gatewayPort: number,
  peerInfo: {
    id: string,
    multiaddrs: string[],
    protocols: []
  }
}
const onlines:{[index: string]: RoutingData} = {}

router.use('/findpeer', mixGetPost, asyncHandler(async (req, res, next) => {
  // @ts-ignore
  let {id} = req.mixed

  if(!id)
    throw `id is not defined`

  const peerInfos: MuonNodeInfo[] = await NetworkIpc.filterNodes({list: [id]})!;

  if(peerInfos.length < 1)
    throw `unknown peerId ${id}`

  const peerInfo = peerInfos[0]

  res.json({
    peerInfo: onlines[peerInfo.id]?.peerInfo
  })
}))

router.use('/query', mixGetPost, asyncHandler(async (req, res, next) => {
  // @ts-ignore
  const {peerId, cid} = req.mixed;
  if(!peerId && !cid)
    throw `peerId or cid most be defined`

  res.json({
    list: []
  })
}))

router.use('/discovery', mixGetPost, asyncHandler(async (req, res, next) => {
  // @ts-ignore
  const {timestamp, gatewayPort, peerInfo, signature} = req.mixed;

  if(!gatewayPort || !timestamp || !peerInfo || !signature)
    throw `missing data`

  let realPeerInfo: MuonNodeInfo[] = await NetworkIpc.filterNodes({list: [peerInfo.id]});
  if(realPeerInfo.length < 1)
    throw `unknown peerId`;

  if(!peerInfo?.multiaddrs || !Array.isArray(peerInfo.multiaddrs) || peerInfo.multiaddrs.length === 0)
    throw `empty multiaddrs list`

  let hash = muonSha3(
    {type: "uint16", value: gatewayPort},
    {type: "uint64", value: timestamp},
    {type: "string", value: peerInfo.id},
    ...(
      peerInfo.multiaddrs.map(value => ({type: "string", value}))
    )
  )
  // @ts-ignore
  const wallet = crypto.recover(hash, signature)
  if(wallet !== realPeerInfo[0].wallet) {
    console.log('delegate signature mismatch')
    console.dir({
      wallet,
      // @ts-ignore
      req: req.mixed,
      realPeerInfo
    }, {depth: 5})
    throw `signature mismatch`
  }

  onlines[realPeerInfo[0].id] = {
    timestamp,
    id: realPeerInfo[0].id,
    gatewayPort,
    peerInfo
  }

  log(`peerInfo arrived from %s`, peerInfo.id)
  res.json({
    success: true
  })
}))

/**
 List online nodes filtered by online duration.
 (default duration: 60 minutes)
 */
router.use('/onlines', mixGetPost, asyncHandler(async (req, res, next) => {
  // @ts-ignore
  let {duration=60} = req.mixed

  const time = Date.now() - duration*60000;
  res.json(
    Object.values(onlines)
      .filter(p => p.timestamp > time)
  )
}))

export default router;
