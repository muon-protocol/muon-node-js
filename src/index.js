const cluster = require('cluster');
const Gateway = require('./gateway')
const Networking = require('./networking');
const NetworkingIpc = require('./networking/ipc');
const SharedMemory = require('./common/shared-memory')
const { parseBool } = require('./utils/helpers')


let clusterCount = 1;
if(parseBool(process.env.CLUSTER_MODE)) {
  if(process.env.CLUSTER_COUNT) {
    clusterCount = parseInt(process.env.CLUSTER_COUNT);
  }
  else{
    clusterCount = require('os').cpus().length;
  }
}

const applicationWorkers = {};

function runNewApplicationCluster() {
  let child = cluster.fork({MASTER_PROCESS_ID: process.pid});
  applicationWorkers[child.process.pid] = child
  return child;
}

async function boot() {
  if (cluster.isMaster) {
    SharedMemory.startServer();

    /** Start gateway */
    Gateway.start({
      host: process.env.GATEWAY_HOST,
      port: process.env.GATEWAY_PORT,
    })

    await Networking.start()
    //
    cluster.on("exit", async function (worker, code, signal) {
      console.log(`Worker ${worker.process.pid} died with code: ${code}, and signal: ${signal}`);
      delete applicationWorkers[worker.process.pid];
      await NetworkingIpc.reportClusterStatus(worker.process.pid, 'exit')

      console.log("Starting a new worker");
      let child = runNewApplicationCluster();
      await NetworkingIpc.reportClusterStatus(child.process.pid, 'start')
    });

    // /** Start core */
    // require('./core').start();
    /** Start application clusters */
    for (let i = 0; i < clusterCount; i++) {
      let child = runNewApplicationCluster();
      await NetworkingIpc.reportClusterStatus(child.process.pid, 'start')
    }
  } else {
    console.log(`application cluster start pid:${process.pid}`)
    require('./core').start();
  }
}

boot();
