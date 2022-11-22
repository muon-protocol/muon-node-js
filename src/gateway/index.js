let express = require('express')
var cors = require('cors')
let bodyParser = require('body-parser')
let mongoose = require('mongoose')
let api = require('./api')
const log = require('debug')('muon:gateway')

let app = express()

function start(options) {
  log(`gateway starting ...`)
  var port = options.port || 8080
  var host = options.host || '127.0.0.1'

  app.use(cors())

  app.use(
    bodyParser.urlencoded({
      extended: true
    })
  )
  app.use(bodyParser.json())

  mongoose.connect(process.env.MONGODB_CS, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  var db = mongoose.connection

  if (!db)
    log('Error connecting db')
  else {
    log("Db connected successfully")
    app.use('/v1/', api)
    app.use('/status', (req, res, next) => {
      res.json({
        running: true
      })
    })
  }

  app.listen(port, host, function () {
    log(`Running gateway on port ${port} at ${host}`)
  })
}

module.exports = {
  start
}
