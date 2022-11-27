import Muon, {MuonPlugin, MuonPluginConfigs} from './muon'
let mongoose = require('mongoose')
const path = require('path');
const fs = require('fs');
const {dynamicExtend} = require('./utils')
import BaseApp from './plugins/base/base-app-plugin'
require('./global')
const loadConfigs = require('../network/configurations')
const {utils: {sha3}} = require('web3')
const chalk = require('chalk')
import {Constructor} from "../common/types";
import BasePlugin from "./plugins/base/base-plugin";
const log = require('../common/muon-log')('muon:core')

async function getEnvPlugins(): Promise<MuonPlugin[]> {
  let pluginsStr = process.env['MUON_PLUGINS']
  if (!pluginsStr)
    return []
  let result: MuonPlugin[] = [];
  for (let key of pluginsStr.split('|')) {
    result.push({name: `__${key}__`, module: (await import(`./plugins/${key}`)).default, config: {}})
  }
  return result
}

function isV3(app) {
  return !!app.signParams;
}

function prepareApp(app, fileName, isBuiltInApp=false): [Constructor<BasePlugin>, MuonPluginConfigs] {
  if(!app.APP_ID) {
    if(isV3(app)) {
      app.APP_ID = sha3(fileName);
    }
    else {
      console.log(chalk.yellow(`Deprecated app version: ${app.APP_NAME} app has old version and need to upgrade to v3.`))
      app.APP_ID = '0x' + sha3(fileName).slice(-8);
    }
  }

  app.APP_ID = BigInt(app.APP_ID).toString(10);
  app.isBuiltInApp = isBuiltInApp;
  return [dynamicExtend(BaseApp, app), {}]
}

function loadApp(path) {
  try {
    require.resolve(path)
    return require(path)
  }
  catch (e) {
    console.error(chalk.red(`Error when loading app from path [${path}]`))
    console.error(e);
    return undefined
  }
}

function getCustomApps(): MuonPlugin[] {
  let pluginsStr = process.env['MUON_CUSTOM_APPS']
  if (!pluginsStr)
    return []
  let result: MuonPlugin[] = []
  pluginsStr.split('|').forEach((name) => {
    let app = loadApp(`../../apps/custom/${name}`)
    if (app && !!app.APP_NAME) {
      const [module, config] = prepareApp(app, `${name}.js`);
      result.push({name, module, config})
    }
  })
  return result;
}

function getBuiltInApps(): MuonPlugin[] {
  const appDir = path.join(__dirname, '../built-in-apps');
  let result: MuonPlugin[] = [];
  let files = fs.readdirSync(appDir);
  files.forEach((file) => {
    let ext = file.split('.').pop();
    if (ext.toLowerCase() === 'js') {
      let app = loadApp(`../built-in-apps/${file}`)
      if (app && !!app.APP_NAME) {
        const [module, config] = prepareApp(app, file, true)
        result.push({name: app.APP_NAME, module, config})
      }
    }
  });
  return result
}

function getGeneralApps(): MuonPlugin[] {
  const appDir = path.join(__dirname, '../../apps/general');
  let result: MuonPlugin[] = [];
  let files = fs.readdirSync(appDir);
  files.forEach((file) => {
    let ext = file.split('.').pop();
    if (ext.toLowerCase() === 'js') {
      let app = loadApp(`../../apps/general/${file}`)
      if (app && !!app.APP_NAME) {
        const [module, config] = prepareApp(app, file)
        result.push({name: app.APP_NAME, module, config})
      }
    }
  });
  return result
}

var muon;

async function start() {
  log('starting ...')
  await mongoose.connect(process.env.MONGODB_CS, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })

  if (!mongoose.connection)
    throw 'Error connecting to MongoDB'

  log(`MongoDB successfully connected.`)

  let config = await loadConfigs();
  let {
    net,
    tss,
  } = config
  try {
    // const nodeVersion = process.versions.node.split('.');
    // if(nodeVersion[0] < '16')
    //   throw {message: `Node version most be >="16.0.0". current version is "${process.versions.node}"`}
    muon = new Muon({
      plugins: [
        {name: 'collateral', module: (await import('./plugins/collateral-info')).default, config: {}},
        {name: 'app-manager', module: (await import('./plugins/app-manager')).default, config: {}},
        {name: 'remote-call', module: (await import('./plugins/remote-call')).default, config: {}},
        {name: 'gateway-interface', module: (await import('./plugins/gateway-Interface')).default, config: {}},
        {name: 'ipc', module: (await import('./plugins/core-ipc-plugin')).default, config: {}},
        {name: 'ipc-handlers', module: (await import('./plugins/core-ipc-handlers')).default, config: {}},
        {name: 'broadcast', module: (await import('./plugins/broadcast')).default, config: {}},
        {name: 'content-verify', module: (await import('./plugins/content-verify-plugin')).default, config: {}},
        {name: 'content', module: (await import('./plugins/content-app')).default, config: {}},
        {name: 'memory', module: (await import('./plugins/memory-plugin')).default, config: {}},
        {name: 'tss-plugin', module: (await import('./plugins/tss-plugin')).default, config: {}},
        {name: 'health-check', module: (await import('./plugins/health-check')).default, config: {}},
        {name: 'explorer', module: (await import('./plugins/explorer')).default, config: {}},
        {name: 'system', module: (await import('./plugins/system')).default, config: {}},
        ...await getEnvPlugins(),
        ...getCustomApps(),
        ...getGeneralApps(),
        ...getBuiltInApps(),
      ],
      net,
      // TODO: pass it into the tss-plugin
      tss,
    })

    await muon.initialize();

    muon.start();
  } catch (e) {
    console.error(e);
    throw e
  }
}

module.exports = {
  start
}

