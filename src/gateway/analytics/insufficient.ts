import {Router} from 'express';
import {mixGetPost, onlyAdmins} from '../middlewares.js'
import asyncHandler from 'express-async-handler'
import * as NetworkIpc from '../../network/ipc.js'
import * as crypto from "../../utils/crypto.js";
import {muonSha3} from "../../utils/sha3.js";
import {InsufficientPartnersAnalyticData} from "../../common/analitics-reporter";

const router = Router();

const reports:{[index: string]: any[]} = {
}

const nodes = {
  timestamp: 0,
  list: {}
}

router.use('/report', asyncHandler(async (req, res, next) => {
  let {timestamp, signature, wallet, ...otherReportData} = req.body as InsufficientPartnersAnalyticData

  let hash = muonSha3(
    {t: 'uint64', v: timestamp},
    {t: 'address', v: wallet},
    {t: 'string', v: "insufficient-partners-report"}
  )
  const signer = crypto.recover(hash, signature)
  if(signer !== wallet) {
    throw `signature mismatched.`
  }

  /** refresh wallet list */
  if(Date.now() - nodes.timestamp > 60e3) {
    const list = await NetworkIpc.filterNodes({}, {timeout: 1000});
    nodes.timestamp = Date.now()
    nodes.list = list.reduce((obj, n) => (obj[n.wallet]=n, obj), {})
  }

  if(!nodes.list[wallet])
    throw `unknown node wallet`

  const nodeId = nodes.list[wallet].id

  if(!reports[nodeId])
    reports[nodeId] = []
  reports[nodeId].unshift({timestamp, ...otherReportData})
  /** keep last 100 reports */
  reports[nodeId] = reports[nodeId].slice(0, 100)

  res.json({success: true})
}))

router.use('/query', mixGetPost, asyncHandler(async (req, res, next) => {
  // @ts-ignore
  let {id} = req.mixed

  if(nodes.list[id]) {
    id = nodes.list[id].id;
  }

  res.json(reports[id] || null)
}))

router.use('/list', mixGetPost, asyncHandler(async (req, res, next) => {
  res.json({
    list: Object.keys(reports).reduce((obj, id) => {
      obj[id] = reports[id].length
      return obj
    }, {})
  })
}))

export default router;
