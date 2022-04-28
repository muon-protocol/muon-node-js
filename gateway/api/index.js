let router = require('express').Router();
const RequestLog = require('../models/RequestLog')
let NodeCaller = require('../node-caller')

async function storeRequestLog(logData) {
  let log = new RequestLog(logData)
  await log.save();
}

router.use('/', (req, res, next) => {
  let mixed = {
    ...req.query,
    ...req.body,
  }
  let {app, method, params, nSign, mode="sign"} = mixed
  NodeCaller.appCall(app, method, params, nSign, mode)
    .then(result => {
      res.json({success: true, result})
      storeRequestLog({
        time: Date.now(),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        app,
        method,
        mode,
        success: true,
        confirmed: result.confirmed,
        errorMessage: result.confirmed ? "" : "",
      });
    })
    .catch(error => {
      res.json({success: false, ...error})
      storeRequestLog({
        time: Date.now(),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        app,
        method,
        mode,
        success: false,
        confirmed: false,
        errorMessage: error.error.message || error.error,
      });
    })
})

module.exports = router
