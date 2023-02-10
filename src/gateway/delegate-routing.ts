import {Router} from 'express';
import * as NetworkIpc from '../network/ipc.js'
import {mixGetPost} from './middlewares.js'
import {logger} from '@libp2p/logger'
import soliditySha3 from "../utils/soliditySha3.js";
import * as crypto from "../utils/crypto.js";
import {MuonNodeInfo} from "../common/types";

const router = Router();
const log = logger("muon:gateway:routing")

type RoutingData = {
  timestamp: number,
  peerInfo: {
    id: string,
    multiaddrs: string[],
    protocols: []
  }
}
const onlines:{[index: string]: RoutingData} = {}

router.use('/findpeer', mixGetPost, async (req, res, next) => {
  let {id} = req.mixed
  if(!id)
    return res.error({message: `id is not defined`})

  const peerInfos: MuonNodeInfo[] = await NetworkIpc.filterNodes({list: [id]})!;

  if(peerInfos.length < 1){
    console.log(`unknown peerId ${id}`);
    return res.error({message: `unknown peerId ${id}`});
  }

  const peerInfo = peerInfos[0]
  console.log({id, peerInfo})

  try {
    res.json({
      peerInfo: onlines[peerInfo.id]?.peerInfo
    })
  }
  catch (e) {
    if(typeof e == "string")
      e = {message: e}
    res.status(500).send({ message: e.message })
  }
})

router.use('/query', mixGetPost, async (req, res, next) => {
  const {peerId, cid} = req.mixed;
  if(!peerId && !cid)
    return res.error({message: `peerId or cid most be defined`})
  try {
    res.json({
      list: []
    })
  }
  catch (e) {
    if(typeof e == "string")
      e = {message: e}
    res.status(500).send({ message: e.message })
  }
})

router.use('/discovery', mixGetPost, async (req, res, next) => {
  const {timestamp, peerInfo, signature} = req.mixed;
  try {
    if(!timestamp || !peerInfo || !signature)
      throw `missing data`

    let realPeerInfo: MuonNodeInfo[] = await NetworkIpc.filterNodes({list: [peerInfo.id]});
    if(realPeerInfo.length < 1)
      throw `unknown peerId`;

    let hash = soliditySha3([
      {type: "uint64", value: timestamp},
      {type: "string", value: peerInfo.id},
      ...(
        peerInfo.multiaddrs.map(value => ({type: "string", value}))
      )
    ])
    const wallet = crypto.recover(hash, signature)
    if(wallet !== realPeerInfo[0].wallet)
      throw `signature mismatch`

    onlines[realPeerInfo[0].id] = {timestamp, peerInfo}

    log(`peerInfo arrived from %s`, peerInfo.id)
    res.json({
      success: true
    })
  }
  catch (e) {
    res.status(500).send({
      success: false,
      error: e.message
    })
  }
})

/**
 List online nodes filtered by online duration.
 (default duration: 60 minutes)
 */
router.use('/onlines', mixGetPost, async (req, res, next) => {
  let {duration=60} = req.mixed
  const time = Date.now() - duration*60000;
  res.json(
    Object.values(onlines)
      .filter(p => p.timestamp > time)
  )
})

export default router;
