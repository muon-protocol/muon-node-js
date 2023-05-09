import {loadGlobalConfigs, loadNodeConfigs} from "../common/configurations.js";

async function configurations(){

  let net, tss;

  net = loadGlobalConfigs('net.conf.json', 'default.net.conf.json')
  net.tss.threshold = parseInt(net.tss.threshold)
  net.tss.max = parseInt(net.tss.max)

  tss = loadNodeConfigs(`tss.conf.json`)

  return {
    tss,
    net
  }
}

export default configurations;
