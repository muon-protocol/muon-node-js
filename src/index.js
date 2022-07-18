const cluster = require('cluster');
const Gateway = require('./gateway')
const Networking = require('./networking');
const SharedMemory = require('./common/shared-memory')
const { timeout } = require('./utils/helpers')

let {
  MessagePublisher,
  MessageSubscriber,
  QueueProducer,
  QueueConsumer
} = require('./common/message-bus')
const numCPUs = 4; //require('os').cpus().length;

const ON_CHILD_MESSAGE = message => {
  console.log({pid: process.pid, message});
}

const applicationWorkers = {};

function runNewApplicationCluster() {
  let child = cluster.fork({MASTER_PROCESS_ID: process.pid});
  child.on('message', ON_CHILD_MESSAGE);
  applicationWorkers[child.process.pid] = child
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

    // /** Start core */
    // require('./core').start();

    if(numCPUs > 1) {
      /** Start application clusters */
      for (let i = 0; i < numCPUs; i++) {
        runNewApplicationCluster();
      }
    }
    else{
      console.log(`application cluster start pid:${process.pid}`)
      //
      // let consumer = new QueueConsumer('global-events');
      // consumer.on("message", async (data) => {
      //   data.num ++;
      //   return data;
      // })
      require('./core').start()
    }
    //
    // cluster.on("exit", function (worker, code, signal) {
    //   console.log(`Worker ${worker.process.pid} died with code: ${code}, and signal: ${signal}`);
    //   delete applicationWorkers[worker.process.pid];
    //
    //   console.log("Starting a new worker");
    //   runNewApplicationCluster();
    // });
    //
    // console.log(`Master thread PID:${process.pid}, starting clusters...`);

    // let producer = new QueueProducer(require('./networking/plugins/ipc-plugin').IPC_CHANNEL)
    // setTimeout(async () => {
    //   console.log('producer sending message ...')
    //   try {
    //     let [response, processInfo] = await producer.send(
    //       {method: "get-collateral-info", params: {num: 123456}},
    //       {timeout: 120000}
    //     );
    //     console.log(`producer received response: `, response)
    //   } catch (e) {
    //     console.log(e)
    //   }
    // }, 5000)

    // let producer = new QueueProducer('global-events')
    // setTimeout(async () => {
    //   console.log('producer sending message ...')
    //   try {
    //     let [response, processInfo] = await producer.send({type: "hello", message: "this is producer!", process: process.pid});
    //     console.log(`producer received response: `, response)
    //   }catch (e) {
    //     console.log(e)
    //   }
    // }, 5000)
  } else {
    console.log(`application cluster start pid:${process.pid}`)
    //
    // let consumer = new QueueConsumer('global-events');
    // consumer.on("message", async (data) => {
    //   data.num ++;
    //   return data;
    // })
    require('./core').start();
  }
}

boot();
