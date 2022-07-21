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
        time: Date.now(),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        app,
        method,
        params,
        mode,
        gwSign,
        success: true,
        confirmed: result.confirmed,
        errorMessage: result.confirmed ? "" : "",
      });
      res.json({success: true, result})
    })
    .catch(error => {
      storeRequestLog({
        time: Date.now(),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        app,
        method,
        params,
        mode,
        gwSign,
        success: false,
        confirmed: false,
        errorMessage: error.message || error.error,
      });
      res.json({success: false, ...error})
    })
})

module.exports = router
