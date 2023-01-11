import mkdirp from 'mkdirp'
import path from 'path'
import {filePathInfo} from "../utils/helpers.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {__dirname} = filePathInfo(import.meta)

const getConfDir = () => {
  let baseDir = `../../config/`
  return !!process.env.CONFIG_BASE_PATH ? baseDir + process.env.CONFIG_BASE_PATH : baseDir
}

const moduleExist = _module => {
  try{
    require.resolve(_module)
    return true
  }
  catch (e) {
    return false;
  }
}

async function configurations(){
  let configDir = path.join(__dirname, getConfDir());
  mkdirp.sync(configDir);

  let net, tss;

  if(moduleExist(`../../config/global/net.conf.json`)) {
    net = require('../../config/global/net.conf.json')
  }
  else {
    net = require('../../config/global/net.default.conf.json')
  }
  net.tss.threshold = parseInt(net.tss.threshold)
  net.tss.max = parseInt(net.tss.max)

  if(moduleExist(`${configDir}/tss.conf.json`)) {
    tss = require(`${configDir}/tss.conf.json`)
  }

  return {
    tss,
    net
  }
}

export default configurations;
