const Muon = require('./core/muon');
const path = require('path');
const fs = require('fs');
const {dynamicExtend} = require('./core/utils')
const BaseApp = require('./plugins/base/base-app-plugin')
const BaseService = require('./plugins/base/base-service-plugin')
const BaseTssApp = require('./plugins/base/base-tss-app-plugin')
const Gateway = require('./gateway/index')
require('./core/global')
const bootstrap = require('./core/bootstrap')

function getEnvBootstraps() {
  return Object.keys(process.env)
    .filter(key => key.startsWith('PEER_BOOTSTRAP_'))
    .map(key => process.env[key]);
}

function getEnvPlugins() {
  let pluginsStr = process.env['MUON_PLUGINS']
  if (!pluginsStr)
    return {}
  return pluginsStr.split('|').reduce((res, key) => {
    return {
      ...res,
      [`__${key}__`]: [require(`./plugins/${key}`), {}]
    }
  }, {})
}

function getAppParent(app) {
  if (app.useTss === false) {
    return app.isService ? BaseService : BaseApp
  }
  return BaseTssApp;
}

function getCustomApps() {
  let pluginsStr = process.env['MUON_CUSTOM_APPS']
  if (!pluginsStr)
    return {}
  return pluginsStr.split('|').reduce((res, key) => {
    // check if app exist.
    try {
      require.resolve(`./apps/custom/${key}`);
    } catch (e) {
      console.error(e);
      return res;
    }
    // load app
    let app = require(`./apps/custom/${key}`)
    if (!!app.APP_NAME) {
      return {
        ...res,
        [key]: [dynamicExtend(getAppParent(app), app), {}]
      }
    } else {
      return res;
    }
  }, {})
}

function getGeneralApps() {
  const appDir = path.join(__dirname, 'apps/general');
  return new Promise(function (resolve, reject) {
    let result = {};
    fs.readdir(appDir, function (err, files) {
      if (err) {
        reject(err)
      }
      files.forEach(function (file) {
        let ext = file.split('.').pop();
        if (ext.toLowerCase() === 'js') {
          let app = require(`./apps/general/${file}`)
          if (!!app.APP_NAME) {
            result[app.APP_NAME] = [dynamicExtend(getAppParent(app), app), {}]
          }
        }
      });
      resolve(result)
    });
  })
}

var muon;

(async () => {
  let config = await bootstrap();
  let {
    net,
    peerId,
    account,
    tss,
    ... otherConfigs
  } = config
  try {
    muon = new Muon({
      libp2p: {
        // TODO: replace env.peerId with config.peerId
        // nodeId: peerId,
        nodeId: {
          id: process.env.PEER_ID,
          pubKey: process.env.PEER_PUBLIC_KEY,
          privKey: process.env.PEER_PRIVATE_KEY
        },
        port: process.env.PEER_PORT,
        bootstrap: getEnvBootstraps()
      },
      plugins: {
        'collateral': [require('./plugins/collateral-info'), {}],
        'remote-call': [require('./plugins/remote-call'), {}],
        'gateway-interface': [require('./plugins/gateway-Interface'), {}],
        'ping-pong': [require('./plugins/ping-pong'), {}],
        // 'gw-log': [require('./plugins/gateway-log'), {}],
        'content-verify': [require('./plugins/content-verify-plugin'), {}],
        'content': [require('./plugins/content-app'), {}],
        'memory': [require('./plugins/memory-plugin'), {}],
        'tss-plugin': [require('./plugins/tss-plugin'), {}],
        'tss-party-search': [require('./plugins/tss-party-search'), {}],
        'network-status': [require('./plugins/network-status'), {}],
        'group-leader': [require('./plugins/group-leader-plugin'), {}],
        ...getEnvPlugins(),
        ...getCustomApps(),
        ...await getGeneralApps(),
      },
      net,
      account,
      tss,
      ...otherConfigs,
    })

    await muon.initialize();

    muon.start();

    Gateway.start({
      host: process.env.GATEWAY_HOST,
      port: process.env.GATEWAY_PORT,
    })
  } catch (e) {
    console.error(e);
    throw e
  }
})()

