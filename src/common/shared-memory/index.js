const NodeCache = require('node-cache');
const { QueueProducer, QueueConsumer } = require('../message-bus')

const CHANNEL = `muon-shared-memory-${process.env.SIGN_WALLET_ADDRESS}`
/**
 * @type {QueueConsumer}
 */
let requestReceiver = null
let requestSender = new QueueProducer(CHANNEL)

let defaultConfig = {
  request: {
    timeout: 5000,
    timeoutMessage: "SharedMemory request timed out."
  }
};

function startServer(config) {
  defaultConfig = {
    ...defaultConfig,
    ... config
  };
  requestReceiver = new QueueConsumer(CHANNEL)
  requestReceiver.on('message', requestHandler)
}

const storage = new NodeCache({
  stdTTL: 0, // Keep for ever
  useClones: false,
});

async function requestHandler(req) {
  let { action, key, value, ttl } = req;
  console.log('SharedMemory request arrive', req);
  switch (action) {
    case 'set':
      storage.set(key, value, ttl);
      return "Ok"
    case 'get':
      return storage.get(key);
    case 'clear':
      storage.del(key)
      return 'Ok'
    default:
      return "UNKNOWN_ACTION"
  }
}

async function set(key, value, ttl) {
  return await requestSender.send({action: 'set', key, value, ttl}, defaultConfig.request)
}

async function get(key) {
  return await requestSender.send({action: 'get', key}, defaultConfig.request)
}

async function clear(key) {
  return await requestSender.send({action: 'clear', key}, defaultConfig.request)
}

module.exports = {
  startServer,
  get,
  set,
  clear
}
