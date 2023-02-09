import cluster, {Worker} from 'cluster'
import * as os from 'os'
import Log from './common/muon-log.js'
import * as Gateway from './gateway/index.js'
import * as Network from './network/index.js'
import * as Core from './core/index.js'
import * as NetworkIpc from './network/ipc.js'
import * as SharedMemory from './common/shared-memory/index.js'
import { parseBool, timeout } from './utils/helpers.js'
import { createRequire } from "module";

// const require = createRequire(import.meta.url);
const log = Log('muon:boot')

process.on('unhandledRejection', function(reason, _promise) {
  // console.log("Unhandled promise rejection", _promise);
  console.dir(reason, {depth: 5})
  throw `Unhandled promise rejection reason: ${reason}`
});


let clusterCount = 1;
if(parseBool(process.env.CLUSTER_MODE)) {
  if(process.env.CLUSTER_COUNT) {
    clusterCount = parseInt(process.env.CLUSTER_COUNT);
    clusterCount = Math.max(clusterCount, os.cpus().length)
  }
  else{
    clusterCount = Math.min(os.cpus().length, 2);
  }
}

type ApplicationDictionary = {[index: number]: Worker}

const applicationWorkers:ApplicationDictionary = {};

function runNewApplicationCluster(): Worker | null {
  const child:Worker = cluster.fork();//{MASTER_PROCESS_ID: process.pid}
  if(!child?.process?.pid){
    log(`application cluster does not start correctly.`)
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
    log(`Master cluster start at [${process.pid}]`)
    SharedMemory.startServer();

    /** Start gateway */
    Gateway.start({
      host: process.env.GATEWAY_HOST,
      port: process.env.GATEWAY_PORT,
    })
      .catch(e => {
        console.log(`Gateway failed to start.`, e)
      })

    try {
      await Network.start()
    }
    catch (e) {
      console.log(`Network failed to start.`, e)
      throw e
    }
    //
    cluster.on("exit", async function (worker, code, signal) {
      log(`Worker ${worker.process.pid} died with code: ${code}, and signal: ${signal}`);
      if(!worker.process.pid) {
        log(`a worker with an unknown pid stopped working.`)
        await refreshWorkersList();
      }
      else {
        delete applicationWorkers[worker.process.pid];
        await NetworkIpc.reportClusterStatus(worker.process.pid, 'exit')
      }

      await timeout(5000);
      log("Starting a new worker");
      let child = runNewApplicationCluster();
      if(!child){
        return ;
      }
      await NetworkIpc.reportClusterStatus(child.process.pid, 'start')
    });

    /** Start application clusters */
    for (let i = 0; i < clusterCount; i++) {
      const child:Worker|null = runNewApplicationCluster();
      if(child === null){
        i--;
        log(`child process fork failed. trying one more time`);
      }else
        await NetworkIpc.reportClusterStatus(child.process.pid, 'start')
    }
  } else {
    log(`application cluster start pid:${process.pid}`)
    // require('./core').start();
    Core.start();
  }

  // Core.start();
}

boot();
