import {Router} from 'express';
import {mixGetPost} from "./middlewares.js";
import {muonSha3} from "../utils/sha3.js";

const router = Router();

router.use('/', mixGetPost, (req, res, next) => {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (!ip) {
    res.send({success: false, message: "IP is undefined"});
    throw "ip is undefined";
  }
  ip = ip!.toString();
  if (ip.includes(','))
    ip = ip.substring(0, ip.indexOf(','));
  res.send({success: true, ip_addr: ip});
});

export default router;
