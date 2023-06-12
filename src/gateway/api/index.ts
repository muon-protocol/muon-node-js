import {Router} from 'express'
import asyncHandler from 'express-async-handler'
import RequestLog from '../../common/db-models/RequestLog.js'
import {QueueProducer} from '../../common/message-bus/index.js'
import {parseBool} from '../../utils/helpers.js'
import {soliditySha3} from '../../utils/sha3.js'
import * as CoreIpc from '../../core/ipc.js'
import * as NetworkIpc from '../../network/ipc.js'
import axios from 'axios'
import * as crypto from '../../utils/crypto.js'
import {logger} from '@libp2p/logger'
import Ajv from "ajv"
import {mixGetPost} from "../middlewares.js";
import {AppContext, MuonNodeInfo} from "../../common/types";
import {GatewayCallParams} from "../types";
import _ from 'lodash'

const log = logger('muon:gateway:api')
const ajv = new Ajv({coerceTypes: true})
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

function extraLogs(req, result?: any) {
  let logs: any = {
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

async function forwardRequestToADeployer(requestData: GatewayCallParams) {
  let context: AppContext = (await CoreIpc.getAppOldestContext("deployment"))!;
  return forwardRequestToParty(requestData, context);
}

async function forwardRequestToParty(requestData: GatewayCallParams, context: AppContext) {
  const n = context.party.partners.length;
  const candidatePartners = _.shuffle(context.party.partners).slice(0, Math.ceil(n/2));
  const onlinePartner = (await NetworkIpc.findNOnlinePeer(candidatePartners, 1, {timeout: 5000}))[0];

  if(!onlinePartner)
    throw `cannot find any online node to forward request`;
  log(`forwarding request to id:%s`, onlinePartner)
  const timeout = await getAppTimeout(requestData.app);
  return await NetworkIpc.forwardRequest(onlinePartner, requestData, timeout);
}

async function callProperNode(requestData: GatewayCallParams) {
  /** forward deployment app request to Deployer node */
  if(requestData.app === 'deployment'){
    const currentNodeInfo = await NetworkIpc.getCurrentNodeInfo();
    if(!currentNodeInfo || !currentNodeInfo.isDeployer) {
      log(`current node is not deployer`)
      return forwardRequestToADeployer(requestData);
    }
  }

  if(await CoreIpc.isDeploymentExcerpt(requestData.app, requestData.method)) {
    log("Deployment excerpt method call %o", requestData)
    return await requestQueue.send(requestData)
  }

  let context: AppContext|undefined = await CoreIpc.getAppOldestContext(requestData.app);

  /** trying to find context */
  if (!context) {
    const currentNodeInfo: MuonNodeInfo|undefined = await NetworkIpc.getCurrentNodeInfo();
    if(currentNodeInfo!.isDeployer)
      throw `App is not deployed or expired.`

    log("context not found. query the network for context.")
    try {
      const allContexts: any[] = await CoreIpc.queryAppAllContext(requestData.app)
      // if(allContexts.length > 0) {}
      /** find oldest context */
      context = allContexts.reduce((oldest: AppContext, ctx: AppContext): AppContext | undefined => {
        if(!oldest)
          return ctx;
        return ((ctx.deploymentRequest?.data.timestamp ?? Infinity) < (oldest.deploymentRequest?.data.timestamp ?? Infinity)) ? ctx : oldest;
      }, undefined);
    }catch (e) {
      log('query app context failed %o', e)
      throw e;
    }
  }

  if (context) {
    const currentNode: MuonNodeInfo|undefined = await NetworkIpc.getCurrentNodeInfo();
    if(!currentNode) {
      throw `Node not added to network.`
    }
    else{
      if(context.party.partners.includes(currentNode.id)) {
        return await requestQueue.send(requestData)
      }
      else {
        return forwardRequestToParty(requestData, context)
      }
    }
  }
  else {
    log('app context not found and request will forward to a deployer node. %o', requestData)
    return forwardRequestToADeployer(requestData);
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
    },
    fee: {
      type: "object",
      properties: {
        spender: {type: "string"},
        timestamp: {type: "number"},
        signature: {type: "string"},
      },
      required: ["spender", "timestamp", "signature"],
    }
  },
  required: ["app", "method"],
  // additionalProperties: false,
}

let router = Router();

// @ts-ignore
router.use('/', mixGetPost, asyncHandler(async (req, res, next) => {
  // @ts-ignore
  let {app, method, params = {}, nSign, mode = "sign", gwSign, fee} = req.mixed

  if (!["sign", "view"].includes(mode)) {
    return res.json({success: false, error: {message: "Request mode is invalid"}})
  }

  gwSign = parseBool(gwSign);
  const requestData: GatewayCallParams = {app, method, params, nSign, mode, gwSign, fee}
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
        /**
         If request forwarded to other node
         When client calling @gatewayMethod of any plugin, appId is 0
         */
        if(result?.appId !== '0' && result?.gwAddress !== process.env.SIGN_WALLET_ADDRESS) {
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
}))

export default router
