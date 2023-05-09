import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import mongoose from 'mongoose'
import api from './api/index.js'
import status from './status.js'
import mine from './mine.js'
import crashReport from './crash-reports.js'
import delegate from './delegate-routing.js'
import {logger} from '@libp2p/logger'
import {GatewayGlobalConfigs, load as loadConfigs} from './configurations.js';

const log = logger('muon:gateway')
let app = express()

async function start() {
  log(`gateway starting ...`)

  const configs:GatewayGlobalConfigs = loadConfigs()

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

  if(configs.routes.enable.api)
    app.use('/v1/', api)
  if(configs.routes.enable.status)
    app.use('/status', status)
  if(configs.routes.enable.delegate)
    app.use('/delegate', delegate)
  if(configs.routes.enable.mine)
    app.use('/mine', mine)
  if(configs.routes.enable.crashReport)
    app.use('/crash-report', crashReport)

  /**
   Error handler
   */
  app.use((err, req, res, next) => {
    if(typeof err === 'string') {
      err = {message: err}
    }
    res
      .status(500)
      .send({
        success: false,
        error: err.message
      })
  })

  const {port, host} = configs
  app.listen(port, host, function () {
    log(`Running gateway on port ${port} at ${host}`)
  })
}

export {
  start
}
