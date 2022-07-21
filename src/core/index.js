const Muon = require('./muon');
let mongoose = require('mongoose')
const path = require('path');
const fs = require('fs');
const {dynamicExtend} = require('./utils')
const BaseApp = require('./plugins/base/base-app-plugin')
require('./global')
const bootstrap = require('./bootstrap')
const {utils: {sha3}} = require('web3')

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
  return new Promise(function (resolve, reject) {
    let result = {};
    fs.readdir(appDir, function (err, files) {
      if (err) {
        reject(err)
      }
      files.forEach(function (file) {
        let ext = file.split('.').pop();
        if (ext.toLowerCase() === 'js') {
          let app = require(`../../apps/general/${file}`)
          if (!!app.APP_NAME) {
            result[app.APP_NAME] = prepareApp(app, file)
          }
        }
      });
      resolve(result)
    });
  })
}

var muon;

async function start() {
  await mongoose.connect(process.env.MONGODB_CS, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })

  let config = await bootstrap();
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
      // libp2p: {
      //   // TODO: replace env.peerId with config.peerId
      //   // nodeId: peerId,
      //   nodeId: {
      //     id: process.env.PEER_ID,
      //     pubKey: process.env.PEER_PUBLIC_KEY,
      //     privKey: process.env.PEER_PRIVATE_KEY
      //   },
      //   natIp: process.env.PEER_NAT_IP,
      //   host: process.env.PEER_HOST || "0.0.0.0",
      //   port: process.env.PEER_PORT,
      //   bootstrap: getEnvBootstraps()
      // },
      plugins: {
        'collateral': [require('./plugins/collateral-info'), {}],
        'remote-call': [require('./plugins/remote-call'), {}],
        'gateway-interface': [require('./plugins/gateway-Interface'), {}],
        'ipc': [require('./plugins/core-ipc-plugin'), {}],
        'ipc-handlers': [require('./plugins/core-ipc-handlers'), {}],
        'broadcast': [require('./plugins/broadcast'), {}],
        // 'gw-log': [require('./plugins/gateway-log'), {}],
        // 'content-verify': [require('./plugins/content-verify-plugin'), {}],
        // 'content': [require('./plugins/content-app'), {}],
        'memory': [require('./plugins/memory-plugin'), {}],
        'tss-plugin': [require('./plugins/tss-plugin'), {}],
        'tss-party-search': [require('./plugins/tss-party-search'), {}],
        'health-check': [require('./plugins/health-check'), {}],
        ...getEnvPlugins(),
        ...getCustomApps(),
        ...await getGeneralApps(),
        'test-plugin': [require('./plugins/test-plugin'), {}],
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

