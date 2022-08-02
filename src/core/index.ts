import Muon from './muon'
let mongoose = require('mongoose')
const path = require('path');
const fs = require('fs');
const {dynamicExtend} = require('./utils')
import BaseApp from './plugins/base/base-app-plugin'
require('./global')
const loadConfigs = require('../networking/configurations')
const {utils: {sha3}} = require('web3')

async function getEnvPlugins() {
  let pluginsStr = process.env['MUON_PLUGINS']
  if (!pluginsStr)
    return {}
  let result = {};
  pluginsStr.split('|').forEach(async key => {
    result[`__${key}__`] = [(await import(`./plugins/${key}`)).default, {}]
  })
  return result
}

function prepareApp(app, fileName) {
  if(!app.APP_ID) {
    app.APP_ID = '0x' + sha3(fileName).slice(-8);
  }
  return [dynamicExtend(BaseApp, app), {}]
}

function getCustomApps() {
  let pluginsStr = process.env['MUON_CUSTOM_APPS']
  if (!pluginsStr)
    return {}
  return pluginsStr.split('|').reduce((res, key) => {
    // check if app exist.
    try {
      require.resolve(`../../apps/custom/${key}`);
    } catch (e) {
      console.error(e);
      return res;
    }
    // load app
    let app = require(`../../apps/custom/${key}`)
    if (!!app.APP_NAME) {
      return {
        ...res,
        [key]: prepareApp(app, `${key}.js`)
      }
    } else {
      return res;
    }
  }, {})
}

function getGeneralApps() {
  const appDir = path.join(__dirname, '../../apps/general');
  let result = {};
  let files = fs.readdirSync(appDir);
  files.forEach((file) => {
    let ext = file.split('.').pop();
    if (ext.toLowerCase() === 'js') {
      let app = require(`../../apps/general/${file}`)
      if (!!app.APP_NAME) {
        result[app.APP_NAME] = prepareApp(app, file)
      }
    }
  });
  return result
}

var muon;

async function start() {
  await mongoose.connect(process.env.MONGODB_CS, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })

  let config = await loadConfigs();
  let {
    net,
    peerId,
    account,
    tss,
    ... otherConfigs
  } = config
  try {
    // const nodeVersion = process.versions.node.split('.');
    // if(nodeVersion[0] < '16')
    //   throw {message: `Node version most be >="16.0.0". current version is "${process.versions.node}"`}
    muon = new Muon({
      plugins: {
        'collateral': [(await import('./plugins/collateral-info')).default, {}],
        'remote-call': [(await import('./plugins/remote-call')).default, {}],
        'gateway-interface': [(await import('./plugins/gateway-Interface')).default, {}],
        'ipc': [(await import('./plugins/core-ipc-plugin')).default, {}],
        'ipc-handlers': [(await import('./plugins/core-ipc-handlers')).default, {}],
        'broadcast': [(await import('./plugins/broadcast')).default, {}],
        'content-verify': [(await import('./plugins/content-verify-plugin')).default, {}],
        'content': [(await import('./plugins/content-app')).default, {}],
        'memory': [(await import('./plugins/memory-plugin')).default, {}],
        'tss-plugin': [(await import('./plugins/tss-plugin')).default, {}],
        'health-check': [(await import('./plugins/health-check')).default, {}],
        ...await getEnvPlugins(),
        ...getCustomApps(),
        ...getGeneralApps(),
      },
      net,
      account,
      // TODO: pass it into the tss-plugin
      tss,
      ...otherConfigs,
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

