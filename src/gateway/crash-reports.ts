import {Router} from 'express';
import {mixGetPost, onlyAdmins} from './middlewares.js'
import asyncHandler from 'express-async-handler'
import * as NetworkIpc from '../network/ipc.js'
import * as crypto from "../utils/crypto.js";
import {muonSha3} from "../utils/sha3.js";

const router = Router();

const reports:{[index: string]: any} = {
}

const wallets = {
  timestamp: 0,
  list: {}
}

// router.use('/test', async (req, res, next) => {
//   res.json({success: true, timestamp: Date.now()})
//   throw 'crash test done'
// })

router.use('/report', asyncHandler(async (req, res, next) => {
  let {timestamp, signature, wallet, error} = req.body

  let hash = muonSha3(
    {t: 'uint64', v: timestamp},
    {t: 'address', v: wallet},
    {t: 'string', v: "crash-report"}
  )
  const signer = crypto.recover(hash, signature)
  if(signer !== wallet) {
    throw `signature mismatched.`
  }

  /** refresh wallet list */
  if(Date.now() - wallets.timestamp > 60e3) {
    const list = await NetworkIpc.getNodesList(['id', 'wallet'], {timeout: 1000});
    wallets.timestamp = Date.now()
    wallets.list = list.reduce((obj, n) => (obj[n.wallet]=n, obj), {})
  }

  if(!wallets.list[wallet])
    throw `unknown node wallet`

  const nodeId = wallets.list[wallet].id

  reports[nodeId] = {
    timestamp,
    error,
  }

  res.json({success: true})
}))

router.use('/query', mixGetPost, asyncHandler(async (req, res, next) => {
  // @ts-ignore
  let {id} = req.mixed

  if(wallets.list[id]) {
    id = wallets.list[id].id;
  }

  res.json(reports[id] || null)
}))

router.use('/list', mixGetPost, asyncHandler(async (req, res, next) => {
  res.json({
    list: Object.keys(reports).reduce((obj, id) => {
      let message;
      if(!!reports[id].error?.stack){
        message = reports[id].error?.stack.split("\n")[0]
      }
      else {
        message = reports[id].error.reason;
        console.log(reports[id])
        if (typeof message === 'object')
          message = message.message
      }
      if(message === undefined)
        message = reports[id].error
      obj[id] = message
      return obj
    }, {})
  })
}))

export default router;
