const Muon = require('./core/muon');
const Gateway = require('./gateway/index')

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
      'presale': [require('./plugins/muon-presale-plugin'), {}],
      ... getEnvPlugins(),
    }
  })

  await muon.initialize();

  muon.start();

  Gateway.start({
    host: process.env.GATEWAY_HOST,
    port: process.env.GATEWAY_PORT,
  })
})()

