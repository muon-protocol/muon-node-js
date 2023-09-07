import {loadGlobalConfigs} from "../common/configurations.js";
import {NetConfigs} from "../common/types";

async function configurations(fileName?: string): Promise<{net: NetConfigs}>{

  let net;

  if(!!fileName){
    net = loadGlobalConfigs(fileName)
  }
  else {
    net = loadGlobalConfigs('net.conf.json', 'default.net.conf.json')
  }
  net.tss.threshold = parseInt(net.tss.threshold)
  net.tss.max = parseInt(net.tss.max)

  return {
    net
  }
}

export default configurations;
