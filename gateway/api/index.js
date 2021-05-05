let router = require('express').Router();
let NodeCaller = require('../node-caller')

router.use('/:app/:method', (req, res, next) => {
  let {app, method} = req.params
  let params = {
    ...req.query,
    ...req.body,
  }
  NodeCaller.appCall(app, method, params)
    .then(result => {
      res.json({success: true, result})
    })
    .catch(error => {
      res.json({success: false, error})
    })
})

module.exports = router
