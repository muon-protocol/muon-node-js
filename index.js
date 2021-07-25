const Muon = require('./core/muon');
const path = require('path');
const fs = require('fs');
const {dynamicExtend} = require('./core/utils')
const BaseApp = require('./plugins/base/base-app-plugin')
const BaseService = require('./plugins/base/base-service-plugin')
const Gateway = require('./gateway/index')
require('./core/global')

function getEnvBootstraps(){
  return Object.keys(process.env)
    .filter(key => key.startsWith('PEER_BOOTSTRAP_'))
    .map(key => process.env[key]);
}

function getEnvPlugins(){
  let pluginsStr = process.env['MUON_PLUGINS']
  if(!pluginsStr)
    return {}
  return pluginsStr.split('|').reduce((res, key) => {
    return {
      ...res,
      [`__${key}__`]: [require(`./plugins/${key}`), {}]
    }
  }, {})
}

function getCustomApps() {
  let pluginsStr = process.env['MUON_CUSTOM_APPS']
  if (!pluginsStr)
    return {}
  return pluginsStr.split('|').reduce((res, key) => {
    let app = require(`./apps/custom/${key}`)
    if (!!app.APP_NAME) {
      return {
        ...res,
        [key]: [dynamicExtend(app.isService ? BaseService : BaseApp, app), {}]
      }
    }
    else {
      return res;
    }
  }, {})
}

function getGeneralApps(){
  const appDir = path.join(__dirname, 'apps/general');
  return new Promise(function (resolve, reject) {
    let result = {};
    fs.readdir(appDir, function (err, files) {
      if (err) {
        reject(err)
      }
      files.forEach(function (file) {
        let ext = file.split('.').pop();
        if(ext.toLowerCase() === 'js'){
          let app = require(`./apps/general/${file}`)
          if(!!app.APP_NAME) {
            result[app.APP_NAME] = [dynamicExtend(app.isService ? BaseService : BaseApp, app), {}]
          }
        }
      });
      resolve(result)
    });
  })
}

var muon;

(async () => {
  muon = new Muon({
    libp2p: {
      nodeId: {
        id: process.env.PEER_ID,
        pubKey: process.env.PEER_PUBLIC_KEY,
        privKey: process.env.PEER_PRIVATE_KEY
      },
      port: process.env.PEER_PORT,
      bootstrap: getEnvBootstraps()
    },
    plugins: {
      'remote-call': [require('./plugins/remote-call'), {}],
      'gateway-interface': [require('./plugins/gateway-Interface'), {}],
      'ping-pong': [require('./plugins/ping-pong'), {}],
      // 'gw-log': [require('./plugins/gateway-log'), {}],
      'stock-plugin': [require('./plugins/stock-plugin'), {}],
      'eth': [require('./plugins/eth-app-plugin'), {}],
      'content-verify': [require('./plugins/content-verify-plugin'), {}],
      'content': [require('./plugins/content-app'), {}],
      'memory': [require('./plugins/memory-plugin'), {}],
      // 'presale': [require('./plugins/muon-presale-plugin'), {}],
      ... getEnvPlugins(),
      ... getCustomApps(),
      ... await getGeneralApps(),
    }
  })

  await muon.initialize();

  muon.start();

  Gateway.start({
    host: process.env.GATEWAY_HOST,
    port: process.env.GATEWAY_PORT,
  })
})()

