
const cluster = require('cluster');
const numCPUs = 2; //require('os').cpus().length;

const ON_CHILD_MESSAGE = message => {
  console.log({pid: process.pid, message});
}

const applicationWorkers = {};

function runNewApplicationCluster() {
  let child = cluster.fork({MASTER_PROCESS_ID: process.pid});
  child.on('message', ON_CHILD_MESSAGE);
  applicationWorkers[child.process.pid] = child
}

if (cluster.isMaster) {
  /** Start gateway */
  require('./gateway').start({
    host: process.env.GATEWAY_HOST,
    port: process.env.GATEWAY_PORT,
  })

  /** Start core */
  require('./core').start();

  /** Start application clusters */
  for (let i = 0; i < numCPUs; i++) {
    runNewApplicationCluster();
  }

  cluster.on("exit", function (worker, code, signal) {
    console.log(`Worker ${worker.process.pid} died with code: ${code}, and signal: ${signal}`);
    delete applicationWorkers[worker.process.pid];

    console.log("Starting a new worker");
    runNewApplicationCluster();
  });

  console.log(`Master thread PID:${process.pid}, starting clusters...`);
} else {
  console.log(`application cluster start pid:${process.pid}`)
  require('./application').start()
}
