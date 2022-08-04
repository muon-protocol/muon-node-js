import cluster, {Worker} from 'cluster'
import * as os from 'os'

const Gateway = require('./gateway')
const Networking = require('./networking');
const NetworkingIpc = require('./networking/ipc');
const SharedMemory = require('./common/shared-memory')
const { parseBool, timeout } = require('./utils/helpers')


let clusterCount = 1;
if(parseBool(process.env.CLUSTER_MODE)) {
  if(process.env.CLUSTER_COUNT) {
    clusterCount = parseInt(process.env.CLUSTER_COUNT);
  }
  else{
    clusterCount = os.cpus().length;
  }
}

type ApplicationDictionary = {[index: number]: Worker}

const applicationWorkers:ApplicationDictionary = {};

function runNewApplicationCluster(): Worker | null {
  const child:Worker = cluster.fork();//{MASTER_PROCESS_ID: process.pid}
  if(!child?.process?.pid){
    console.log(`application cluster does not start correctly.`)
    return null;
  }
  applicationWorkers[child.process.pid] = child
  return child;
}

async function refreshWorkersList() {
  // TODO: try to find the process that stopped working and remove it from workers list
}

async function boot() {
  if (cluster.isMaster) {
    console.log(`Master cluster start at [${process.pid}]`)
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
      if(!worker.process.pid) {
        console.log(`a worker with an unknown pid stopped working.`)
        await refreshWorkersList();
      }
      else {
        delete applicationWorkers[worker.process.pid];
        await NetworkingIpc.reportClusterStatus(worker.process.pid, 'exit')
      }

      await timeout(5000);
      console.log("Starting a new worker");
      let child = runNewApplicationCluster();
      if(!child){
        return ;
      }
      await NetworkingIpc.reportClusterStatus(child.process.pid, 'start')
    });

    /** Start application clusters */
    for (let i = 0; i < clusterCount; i++) {
      const child:Worker|null = runNewApplicationCluster();
      if(child === null){
        i--;
        console.log(`child process fork failed. trying one more time`);
      }else
        await NetworkingIpc.reportClusterStatus(child.process.pid, 'start')
    }
  } else {
    console.log(`application cluster start pid:${process.pid}`)
    require('./core').start();
  }

  // require('./core').start();
}

boot();
