import {Router} from 'express';
import * as NetworkIpc from '../network/ipc.js'
import {mixGetPost} from './middlewares.js'

const router = Router();

router.use('/findpeer', mixGetPost, async (req, res, next) => {
  let {peerId} = req.mixed
  if(!peerId)
    return res.error({message: `peer is not defined`})

  try {
    res.json({
      peerInfo: await NetworkIpc.getPeerInfoLight(peerId)
    })
  }
  catch (e) {
    res.status(500).send({ message: e.message() })
  }
})

router.use('/query', mixGetPost, async (req, res, next) => {
  const {peerId, cid} = req.mixed;
  if(!peerId && !cid)
    return res.error({message: `peerId or cid most be defined`})
  try {
    res.json({
      list: await NetworkIpc.getClosestPeer(peerId, cid)
    })
  }
  catch (e) {
    res.status(500).send({ message: e.message() })
  }
})

export default router;
