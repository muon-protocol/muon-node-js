import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import mongoose from 'mongoose'
import api from './api/index.js'
import status from './status.js'
import delegate from './delegate-routing.js'
import Log from '../common/muon-log.js'

const log = Log('muon:gateway')
let app = express()

async function start(options) {
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

  await mongoose.connect(process.env.MONGODB_CS!, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })

  if (!mongoose.connection)
    throw 'Error connecting to MongoDB'

  log(`MongoDB successfully connected.`)

  app.use('/v1/', api)
  app.use('/status', status)
  app.use('/delegate', delegate)

  app.listen(port, host, function () {
    log(`Running gateway on port ${port} at ${host}`)
  })
}

export {
  start
}
