import {Router} from 'express';
import * as CoreIpc from '../core/ipc.js'
import {mixGetPost} from "./middlewares.js";
import asyncHandler from 'express-async-handler'
import {muonSha3} from "../utils/sha3.js";
import * as crypto from "../utils/crypto.js";
import {getTimestamp} from "../utils/helpers.js";

const router = Router();

router.use('/last-context-time',mixGetPost, asyncHandler(async (req, res, next) => {
  // @ts-ignore
  let {wallet, timestamp, signature} = req.mixed;

  if(timestamp < getTimestamp()-10e3)
    throw `timestamp expired`;

  let hash = muonSha3(
    { type: "uint64", value: timestamp },
    { type: "address", value: wallet },
    { type: "string", value: `give me my last context time` }
  );

  // @ts-ignore
  const signer = crypto.recover(hash, signature);
  if (wallet !== signer) {
    throw `Invalid signature`;
  }

  const lastTime: number|null = await CoreIpc.getNodeLastContextTime(wallet);
  res.json({
    timestamp: lastTime
  })
}));

export default router
