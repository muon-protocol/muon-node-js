import fs from 'fs'
import * as path from 'path';
import _ from 'lodash'
import {filePathInfo} from "../../utils/helpers.js";

const {__dirname} = filePathInfo(import.meta)
const CONF_PATH = path.join(__dirname, "../cmd.conf.json")

export type CmdConfigs = {
  url?: string
}

export function getConfigs(): CmdConfigs {
  let configs = {};
  if(fs.existsSync(CONF_PATH)) {
    let content = fs.readFileSync(CONF_PATH).toString();
    configs = JSON.parse(content)
  }
  return configs
}

export const command = 'config <action> [key] [value]'

export const describe = 'Set config key:value'

export const builder = {
  action: {
    describe: "Get/Set values",
    choices: ['get', 'set'],
    type: 'string',
  },
  key: {
    describe: "Config property name",
    choices: ['url'],
    type: 'string',
  },
  value: {
    describe: "Property value",
    type: 'string',
  },
}

export async function handler(argv) {
  const {action, key, value} = argv;
  let configs = getConfigs()

  if(action === 'get') {
    return console.log(configs)
  }
  else {
    _.set(configs, key, value)
    fs.writeFileSync(CONF_PATH, JSON.stringify(configs, null, 2))
    console.log("Configuration updated successfully", configs);
  }
}
