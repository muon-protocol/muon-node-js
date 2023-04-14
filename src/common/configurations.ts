import mkdirp from 'mkdirp'
import path from 'path'
import {filePathInfo} from "../utils/helpers.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {__dirname} = filePathInfo(import.meta)

const CONFIGS_BASE_PATH = `../../config/`
const GLOBAL_CONFIGS_BASE_PATH = "../../config/global"

const getNodeConfigRootDir = () => {
  return !!process.env.CONFIG_BASE_PATH ? CONFIGS_BASE_PATH + process.env.CONFIG_BASE_PATH : CONFIGS_BASE_PATH
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

export function loadNodeConfigs(configPath:string, defaultConfigPath?:string) {
  let configDir = path.join(__dirname, getNodeConfigRootDir());
  mkdirp.sync(configDir);

  let configs;
  const exactPath = path.join(getNodeConfigRootDir(), configPath);
  if(!!configPath && moduleExist(exactPath)) {
    configs = require(exactPath)
  }
  else if(!!defaultConfigPath){
    const exactPath = path.join(getNodeConfigRootDir(), defaultConfigPath);
    if(!moduleExist(exactPath)) {
      throw `unable to load config: ${configPath} or ${defaultConfigPath}`
    }
    configs = require(exactPath)
  }

  return configs;
}

export function loadGlobalConfigs(configPath:string, defaultConfigPath?:string) {
  let configs;
  const exactPath = path.join(GLOBAL_CONFIGS_BASE_PATH, configPath);
  if(!!configPath && moduleExist(exactPath)) {
    configs = require(exactPath)
  }
  else if(!!defaultConfigPath){
    const exactPath = path.join(GLOBAL_CONFIGS_BASE_PATH, defaultConfigPath);
    if(!moduleExist(exactPath)) {
      throw `unable to load config: ${configPath} or ${defaultConfigPath}`
    }
    configs = require(exactPath)
  }

  return configs;
}
