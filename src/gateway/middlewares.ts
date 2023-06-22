import {muonSha3} from "../utils/sha3.js";
import * as crypto from "../utils/crypto.js";
import {RateLimiterMemory} from "rate-limiter-flexible";

/**  */
const ADMIN_WALLETS = (`${process.env.ADMIN_WALLETS||""}|${process.env.SIGN_WALLET_ADDRESS}`)
  .split("|")
  .filter(w => !!w)
  .map(w => w.toLowerCase())

export const mixGetPost = (req, res, next) => {
  // @ts-ignore
  req.mixed = {
    ...req.query,
    ...req.body,
  }
  next();
}

export const onlyAdmins = (req, res, next) => {
  // @ts-ignore
  const {at} = req.mixed
  if(at) {
    let [timestamp, lifetime, signature] = at.split(':')
    timestamp = parseInt(timestamp)
    lifetime = parseInt(lifetime)
    if(timestamp < 0)
      throw `bad access token`
    let hash = muonSha3(
      {t: 'uint64', v: timestamp},
      {t: 'uint64', v: lifetime},
      {t: 'string', v: 'muon-admin-access'},
    )

    const signer = crypto.recover(hash, signature)

    if(!ADMIN_WALLETS.includes(signer.toLowerCase()))
      throw `Admin restricted`

    if(timestamp + lifetime < Date.now())
      throw `access token expired`

    next();
  }
  else {
    throw `Admin restricted`
  }
}

export function rateLimit(options) {
  const rateLimiter = new RateLimiterMemory(options);
  return (req, res, next) => {
    if(!options.enabled)
      next();
    rateLimiter.consume(req.ip)
      .then(() => {
        next();
      })
      .catch(_ => {
        res.status(429).send('Too Many Requests');
      });
  };
}
