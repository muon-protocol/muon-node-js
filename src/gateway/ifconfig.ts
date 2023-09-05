import {Router} from 'express';
import {mixGetPost} from "./middlewares.js";
import {muonSha3} from "../utils/sha3.js";

const router = Router();

router.use('/', mixGetPost, (req, res, next) => {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  ip = ip as string;
  if (!ip)
    throw "ip is undefined";
  if (ip.includes(','))
    ip = ip.substring(0, ip.indexOf(','));
  res.send({success: true, ip_addr: ip});
});

export default router;
