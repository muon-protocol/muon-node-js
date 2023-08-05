import {Router} from 'express'
import asyncHandler from 'express-async-handler'
import RequestLog from '../../common/db-models/RequestLog.js'
import {QueueProducer} from '../../common/message-bus/index.js'
import {parseBool} from '../../utils/helpers.js'
import * as CoreIpc from '../../core/ipc.js'
import * as NetworkIpc from '../../network/ipc.js'
import {logger} from '@libp2p/logger'
import Ajv from "ajv"
import {mixGetPost} from "../middlewares.js";
import {AppContext, MuonNodeInfo} from "../../common/types";
import {GatewayCallParams} from "../types";

const log = logger('muon:gateway:api')
const ajv = new Ajv({coerceTypes: true})
let requestQueue = new QueueProducer(`gateway-requests`);

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
  result: false
};
async function isCurrentNodeInNetwork() {
  /** check every 5 minute */
  const dt = Date.now() - cachedNetworkCheck.time
  /** cache true for 5 minutes and false for 5 seconds*/
  if((cachedNetworkCheck.result && dt > 300e3) || (!cachedNetworkCheck.result && dt > 5e3)) {
    cachedNetworkCheck.time = Date.now()
    cachedNetworkCheck.result = await NetworkIpc.isCurrentNodeInNetwork()
  }

  return cachedNetworkCheck.result;
}

async function callProperNode(requestData: GatewayCallParams) {
  if(await CoreIpc.isDeploymentExcerpt(requestData.app, requestData.method)) {
    log("Deployment excerpt method call %o", requestData)
    return await requestQueue.send(requestData)
  }

  let context: AppContext|undefined = await CoreIpc.getAppOldestContext(requestData.app);

  if (context) {
    const currentNode: MuonNodeInfo|undefined = await NetworkIpc.getCurrentNodeInfo();
    if(currentNode) {
      let partners = context.party.partners;
      if(context.keyGenRequest?.data?.init?.shareProofs)
        partners = Object.keys(context.keyGenRequest?.data?.init?.shareProofs)
      if(partners.includes(currentNode.id)) {
        return await requestQueue.send(requestData)
      }
    }
  }

  log('forwarding request to a proper node. %o', requestData)
  return await NetworkIpc.forwardRequest(requestData);
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
    const appId = await CoreIpc.getAppId(app);
    return res.json({
      success: false,
      appId,
      error: {
        message: `The node has no connection to the Muon network.`
      }
    })
  }
  else {
    callProperNode(requestData)
      .then(async result => {
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
