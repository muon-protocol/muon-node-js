import {loadGlobalConfigs} from "../common/configurations.js";
import {NetConfigs} from "../common/types";

async function configurations(fileName?: string): Promise<{net: NetConfigs}>{

  let net:NetConfigs;

  if(!!fileName){
    net = loadGlobalConfigs(fileName) as NetConfigs;
  }
  else {
    net = loadGlobalConfigs('net.conf.json', 'default.net.conf.json') as NetConfigs;
  }
  // @ts-ignore
  net.tss.threshold = parseInt(net.tss.threshold)
  // @ts-ignore
  net.tss.max = parseInt(net.tss.max)

  if(process.env.MAX_CONNECTIONS) {
    net.connectionManager.maxConnections = parseInt(process.env.MAX_CONNECTIONS);
  }

  return {
    net
  }
}

export default configurations;
