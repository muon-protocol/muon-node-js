let router = require('express').Router();
const Controller = require('./api-controller');

router.get('/', Controller.index);

router.get('/request', Controller.getNewRequest)
router.get('/peer/:peerId', Controller.getPeerInfo)

module.exports = router;
