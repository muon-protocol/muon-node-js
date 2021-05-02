const Muon = require('./muon');
const Gateway = require('./gateway/index')

function getEnvBootstraps(){
  return Object.keys(process.env)
    .filter(key => key.startsWith('PEER_BOOTSTRAP_'))
    .map(key => process.env[key]);
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
      'request-handler': [require('./plugins/request-handler'), {}],
    }
  })

  await muon.initialize();

  muon.start();

  Gateway.start({
    host: process.env.GATEWAY_HOST,
    port: process.env.GATEWAY_PORT,
  })
})()
