
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

/** Start gateway */
require('./gateway').start({
  host: process.env.GATEWAY_HOST,
  port: process.env.GATEWAY_PORT,
})
/** Start core */
require('./core').start();
/** Start applications */

// const ON_CHILD_MESSAGE = message => {
//   console.log({pid: process.pid, message});
// }
//
// if( cluster.isMaster && numCPUs > 1 ) {
//   for( let i = 0; i < numCPUs; i++ ) {
//     let child = cluster.fork({MASTER_PROCESS_ID: process.pid});
//
//     child.on('message', ON_CHILD_MESSAGE);
//   }
//   console.log( `Master thread PID:${ process.pid }, starting clusters...` );
// } else {
//   console.log( `Worker thread PID:${ process.pid } started. master process: ${process.env.MASTER_PROCESS_ID}`);
//   if(process.send) {
//     process.send(`hi parent. im child[${process.pid}].`)
//     for(let i=0;i<50000000000000;i++);
//   }
//   else {
//     console.log('process has no send method.')
//   }
// }
