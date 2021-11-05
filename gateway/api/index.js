let router = require('express').Router();
let NodeCaller = require('../node-caller')

function needToForward(error) {
  return true
}

router.use('/', (req, res, next) => {
  let mixed = {
    ...req.query,
    ...req.body,
  }
  let {app, method, params, nSign} = mixed
  NodeCaller.callApp(app, method, params, nSign)
    // .catch(async error => {
    //   if(needToForward(error)){
    //     return NodeCaller.callMuon('forward-request', {app, method, params, nSign});;
    //   }
    //   else {
    //     throw error;
    //   }
    // })
    .then(result => {
      res.json({success: true, result})
    })
    .catch(error => {
      res.json({success: false, error})
    })
})

module.exports = router
