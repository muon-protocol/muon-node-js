let router = require('express').Router();
const RequestLog = require('../../common/db-models/RequestLog')
const { QueueProducer } = require('../../common/message-bus')
let NodeCaller = require('../node-caller')
let requestQueue = new QueueProducer(`gateway-requests`);
let { parseBool } = require('../../utils/helpers')
const CoreIpc = require('../../core/ipc')
const NetworkIpc = require('../../networking/ipc')

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
  if(result?.confirmed) {
    logs.extra = {
      ... logs.extra,
      nonce: result.data?.init?.nonceAddress,
      reqHash: result.reqId
    }
  }
  return logs;
}

router.use('/', (req, res, next) => {
  let mixed = {
    ...req.query,
    ...req.body,
  }
  let {app, method, params={}, nSign, mode="sign", gwSign} = mixed

  if(!["sign", "view"].includes(mode)) {
    return res.json({success: false, error: {message: "Request mode is invalid"}})
  }
  // NodeCaller.appCall(app, method, params, nSign, mode)
  gwSign = parseBool(gwSign);
  const requestData = {app, method, params, nSign, mode, gwSign}
  requestQueue.send(requestData)
    /** some errors may need to be handled */
    .catch(async error => {
      if(error.message === "App not deployed") {
        // find deployment info
        let context = await CoreIpc.queryAppContext(app)
        let partners = context.party.partners
        if(context) {
          const randomIndex = Math.floor(Math.random() * partners.length);
          console.log(`forwarding request to ${partners[randomIndex]} ...`);
          return await NetworkIpc.forwardRequest(partners[randomIndex], requestData)
        }
        // forward request to app group
      }
      /** forward error to next catch and prepare response */
      throw error
    })
    .then(result=> {
      storeRequestLog({
        app,
        method,
        params,
        mode,
        gwSign,
        success: true,
        confirmed: result?.confirmed,
        errorMessage: result?.confirmed ? "" : "",
        ... extraLogs(req, result),
      });
      res.json({success: true, result})
    })
    .catch(async error => {
      let appId
      try {
        appId = await CoreIpc.getAppId(app);
      }catch (e) {
        console.log("gateway.api", e)
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
        ... extraLogs(req),
      });
      res.json({success: false, appId, error})
    })
})

module.exports = router
