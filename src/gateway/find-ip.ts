import {Router} from 'express';
import {mixGetPost} from "./middlewares.js";
import {muonSha3} from "../utils/sha3.js";

const router = Router();

router.use('/', mixGetPost, (req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  res
    .send({success: true, ip_addr: ip})
});

export default router;
