let router = require('express').Router();
const RequestLog = require('../models/RequestLog')
const { QueueProducer } = require('../../common/message-bus')
let NodeCaller = require('../node-caller')
let requestQueue = new QueueProducer(`gateway-requests`);
let { parseBool } = require('@src/utils/helpers')

async function storeRequestLog(logData) {
  let log = new RequestLog(logData)
  await log.save();
}

function reqLogInfo(req) {
  return {
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
}

router.use('/', (req, res, next) => {
  let mixed = {
    ...req.query,
    ...req.body,
  }
  let {app, method, params, nSign, mode="sign", gwSign} = mixed
  // NodeCaller.appCall(app, method, params, nSign, mode)
  gwSign = parseBool(gwSign);
  requestQueue.send({app, method, params, nSign, mode, gwSign})
    .then(result=> {
      storeRequestLog({
        app,
        method,
        params,
        mode,
        gwSign,
        success: true,
        confirmed: result.confirmed,
        errorMessage: result.confirmed ? "" : "",
        ... reqLogInfo(req),
      });
      res.json({success: true, result})
    })
    .catch(error => {
      storeRequestLog({
        app,
        method,
        params,
        mode,
        gwSign,
        success: false,
        confirmed: false,
        errorMessage: error.message || error.error,
        ... reqLogInfo(req),
      });
      res.json({success: false, ...error})
    })
})

module.exports = router
