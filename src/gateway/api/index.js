import {Router} from 'express'
import RequestLog from '../../common/db-models/RequestLog.js'
import {QueueProducer} from '../../common/message-bus/index.ts'
import {parseBool} from '../../utils/helpers.js'
import soliditySha3 from '../../utils/soliditySha3.js'
import * as CoreIpc from '../../core/ipc.ts'
import * as NetworkIpc from '../../network/ipc.ts'
import axios from 'axios'
import * as crypto from '../../utils/crypto.js'
import Log from '../../common/muon-log.js'
import Ajv from "ajv"
import {mixGetPost} from "../middlewares.js";

const log = Log('muon:gateway:api')
const ajv = new Ajv()
let requestQueue = new QueueProducer(`gateway-requests`);

const SHIELD_FORWARD_URL = process.env.SHIELD_FORWARD_URL
const appIsShielded = (process.env.SHIELDED_APPS || "")
  .split('|')
  .reduce((acc, curr) => {
    acc[curr] = true
    return acc
  }, {});

async function storeRequestLog(logData) {
  let log = new RequestLog(logData)
  await log.save();
}

function extraLogs(req, result) {
  let logs = {
    time: Date.now(),
    ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress,
    extra: {
      referrer: req.get('Referer'),
      cra: req.connection.remoteAddress,
      sra: req.socket.remoteAddress,
      csra: req.connection.socket?.remoteAddress,
      headers: req.headers,
    }
  }
  if (result?.confirmed) {
    logs.extra = {
      ...logs.extra,
      nonce: result.data?.init?.nonceAddress,
      reqId: result.reqId
    }
  }
  return logs;
}

let cachedNetworkCheck = {
  time: 0,
  result: undefined
};
async function isCurrentNodeInNetwork() {
  /** check every 5 minute */
  if(Date.now() - cachedNetworkCheck.time > 30e3) {
    cachedNetworkCheck.time = Date.now()
    cachedNetworkCheck.result = await NetworkIpc.isCurrentNodeInNetwork()
  }

  return cachedNetworkCheck.result;
}

const appTimeouts = {}
async function getAppTimeout(app) {
  if(appTimeouts[app] === undefined) {
    appTimeouts[app] = await CoreIpc.getAppTimeout(app);
  }
  return appTimeouts[app];
}

async function callProperNode(requestData) {
  /** forward deployment app request to Deployer node */
  if(requestData.app === 'deployment'){
    const currentNodeInfo = await NetworkIpc.getCurrentNodeInfo();
    if(!currentNodeInfo || !currentNodeInfo.isDeployer) {
      log(`current node is not deployer`)
      let deployers = await NetworkIpc.filterNodes({isDeployer: true}).map(p => p.peerId);
      let onlineDeployers = await NetworkIpc.findNOnlinePeer(deployers, 2, {timeout: 5000})
      if(!onlineDeployers.length > 0)
        throw `cannot find any online deployer to forward request`;
      const randomIndex = Math.floor(Math.random() * onlineDeployers.length);
      log(`forwarding request to id:%s`, onlineDeployers[randomIndex].id)
      const timeout = await getAppTimeout(requestData.app);
      return await NetworkIpc.forwardRequest(onlineDeployers[randomIndex].id, requestData, timeout);
    }
  }

  if(await CoreIpc.isDeploymentExcerpt(requestData.app, requestData.method)) {
    log("Deployment excerpt method call %o", requestData)
    return await requestQueue.send(requestData)
  }

  let context = await CoreIpc.getAppContext(requestData.app);
  if (!context) {
    log("context not found. query the network for context.")
    try {
      context = await CoreIpc.queryAppContext(requestData.app)
    }catch (e) {
      log('query app context failed %o', e)
      throw e;
    }
  }
  if (!context) {
    log('app context not found and it throwing error %o', requestData)
    throw `App not deployed`;
  }
  const {partners} = context.party
  const currentNodeInfo = await NetworkIpc.getCurrentNodeInfo();
  if (partners.includes(currentNodeInfo.id)) {
    return await requestQueue.send(requestData)
  } else {
    const randomIndex = Math.floor(Math.random() * partners.length);
    log(`forwarding request to id:%s`, partners[randomIndex])
    const timeout = await getAppTimeout(requestData.app);
    let request = await NetworkIpc.forwardRequest(partners[randomIndex], requestData, timeout);
    // if(requestData.gwSign){
    //   const {hash: shieldHash} = await CoreIpc.shieldConfirmedRequest(request);
    //   const requestHash = soliditySha3(request.data.signParams)
    //   if(shieldHash !== requestHash)
    //     throw `Shield result mismatch.`
    //   request.gwAddress = process.env.SIGN_WALLET_ADDRESS;
    //   request.gwSignature = "";
    // }
    return request
  }
}

async function shieldConfirmedResult(requestData, request) {
  log(`Shield applying %o`, requestData)
  const {hash: shieldHash} = await CoreIpc.shieldConfirmedRequest(request);
  const requestHash = soliditySha3(request.data.signParams)
  if(shieldHash !== requestHash)
    throw `Shield result mismatch.`
  request.shieldAddress = process.env.SIGN_WALLET_ADDRESS;
  let cryptoSign = crypto.sign(shieldHash);
  request.shieldSignature = cryptoSign;
  request.nodeSignature = cryptoSign;
}

const MUON_REQUEST_SCHEMA = {
  type: "object",
  properties: {
    app: {type: "string"},
    method: {type: "string"},
    // params: {type: "object"},
    gwSign: {type: "boolean"},
    nSign: {type: "number"},
    mode: {
      enum: ["sign", "view"],
      default: "sign",
    }
  },
  required: ["app", "method"],
  // additionalProperties: false,
}

let router = Router();

router.use('/', mixGetPost, async (req, res, next) => {
  let {app, method, params = {}, nSign, mode = "sign", gwSign} = req.mixed

  if (!["sign", "view"].includes(mode)) {
    return res.json({success: false, error: {message: "Request mode is invalid"}})
  }

  gwSign = parseBool(gwSign);
  const requestData = {app, method, params, nSign, mode, gwSign}
  log("request arrived %o", requestData);

  if(!ajv.validate(MUON_REQUEST_SCHEMA, requestData)){
    return res.json({
      success: false,
      error: {
        message: "muon call validation error",
        items: ajv.errors
      }
    })
  }

  if(!await isCurrentNodeInNetwork()){
    log("This node in not in the network.")
    if(!SHIELD_FORWARD_URL) {
      log("Env variable 'SHIELD_FORWARD_URL' not specified.")
      const appId = await CoreIpc.getAppId(app);
      return res.json({
        success: false,
        appId,
        error: {
          message: `Shield forward url (SHIELD_FORWARD_URL) not configured.`
        }
      })
    }
    if(!appIsShielded[app]) {
      log("This app is not shielded.")
      return res.json({success: false, error: {message: `The '${app}' app is neither shielded nor included in the network.`}});
    }
    log(`forwarding request to ${SHIELD_FORWARD_URL}`, requestData);
    const result = await axios.post(SHIELD_FORWARD_URL, requestData)
      .then(({data}) => data)
    if(result.success) {
      await shieldConfirmedResult(requestData, result.result)
    }
    return res.json(result);
  }
  else {
    callProperNode(requestData)
      .then(async result => {
        /** if request forwarded to other node */
        if(result.gwAddress !== process.env.SIGN_WALLET_ADDRESS) {
          if(appIsShielded[app]) {
            await shieldConfirmedResult(requestData, result)
          }
        }

        storeRequestLog({
          app,
          method,
          params,
          mode,
          gwSign,
          success: true,
          confirmed: result?.confirmed,
          errorMessage: result?.confirmed ? "" : "",
          ...extraLogs(req, result),
        });
        res.json({success: true, result})
      })
      .catch(async error => {
        if (typeof error === "string")
          error = {message: error}
        let appId
        try {
          appId = await CoreIpc.getAppId(app);
        } catch (e) {
          log("gateway.api error %o", e)
        }
        storeRequestLog({
          app,
          method,
          params,
          mode,
          gwSign,
          success: false,
          confirmed: false,
          errorMessage: error.message || error.error,
          ...extraLogs(req),
        });
        const {message, ...otherProps} = error;
        res.json({
          success: false,
          appId,
          error: {
            message: message || `Unknown error occurred`,
            ...otherProps
          }
        })
      })
  }
})

export default router
