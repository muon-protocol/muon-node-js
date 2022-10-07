let router = require('express').Router();
const RequestLog = require('../../common/db-models/RequestLog')
const {QueueProducer} = require('../../common/message-bus')
let requestQueue = new QueueProducer(`gateway-requests`);
let {parseBool} = require('../../utils/helpers')
const CoreIpc = require('../../core/ipc')
const NetworkIpc = require('../../network/ipc')

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
      reqHash: result.reqId
    }
  }
  return logs;
}

async function callProperNode(requestData) {
  if(['__info', '__deploy'].includes(requestData.method))
    return await requestQueue.send(requestData)
  let context = await CoreIpc.getAppContext(requestData.app);
  if (!context) {
    console.log("context not found. query the network for context.")
    context = await CoreIpc.queryAppContext(requestData.app)
  }
  if (!context)
    throw `App not deployed`;
  const {partners} = context.party
  if (partners.includes(process.env.SIGN_WALLET_ADDRESS)) {
    return await requestQueue.send(requestData)
  } else {
    const randomIndex = Math.floor(Math.random() * partners.length);
    return await NetworkIpc.forwardRequest(partners[randomIndex], requestData)
  }
}

router.use('/', async (req, res, next) => {
  let mixed = {
    ...req.query,
    ...req.body,
  }
  let {app, method, params = {}, nSign, mode = "sign", gwSign} = mixed

  if (!["sign", "view"].includes(mode)) {
    return res.json({success: false, error: {message: "Request mode is invalid"}})
  }

  gwSign = parseBool(gwSign);
  const requestData = {app, method, params, nSign, mode, gwSign}
  callProperNode(requestData)
    .then(result => {
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
      if(typeof error === "string")
        error = {message: error}
      let appId
      try {
        appId = await CoreIpc.getAppId(app);
      } catch (e) {
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
})

module.exports = router
