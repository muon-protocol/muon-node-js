let router = require('express').Router();
let NodeCaller = require('../node-caller')

router.use('/', (req, res, next) => {
  let mixed = {
    ...req.query,
    ...req.body,
  }
  let {app, method, params} = mixed
  NodeCaller.appCall(app, method, params)
    .then(result => {
      res.json({success: true, result})
    })
    .catch(error => {
      res.json({success: false, error})
    })
})

module.exports = router
