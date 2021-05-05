const StockPrice = require('./stock/routes')
let router = require('express').Router();

router.use('/stock', StockPrice)

module.exports = router
