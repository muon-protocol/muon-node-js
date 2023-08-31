import {loadGlobalConfigs} from "../common/configurations.js";

async function configurations(){

  let net;

  net = loadGlobalConfigs('net.conf.json', 'default.net.conf.json')
  net.tss.threshold = parseInt(net.tss.threshold)
  net.tss.max = parseInt(net.tss.max)

  return {
    net
  }
}

export default configurations;
