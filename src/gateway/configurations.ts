import {loadGlobalConfigs} from "../common/configurations.js";
import {parseBool} from "../utils/helpers.js";

export type GatewayGlobalConfigs = {
  host: string,
  port: number,
  routes: {
    enable: {
      api: boolean,
      status: boolean,
      delegate: boolean,
      mine: boolean,
      crashReport: boolean,
      findIp: boolean,
    }
  }
}

export function load(): GatewayGlobalConfigs{
  const configs:GatewayGlobalConfigs = loadGlobalConfigs('gateway.conf.json', 'default.gateway.conf.json')

  if(process.env.GATEWAY_HOST)
    configs.host = process.env.GATEWAY_HOST

  if(process.env.GATEWAY_PORT)
    configs.port = parseInt(process.env.GATEWAY_PORT)

  if(!!process.env.gateway_routes_enable_api)
    configs.routes.enable.api = parseBool(process.env.gateway_routes_enable_api)

  if(!!process.env.gateway_routes_enable_status)
    configs.routes.enable.status = parseBool(process.env.gateway_routes_enable_status)

  if(!!process.env.gateway_routes_enable_delegate)
    configs.routes.enable.delegate = parseBool(process.env.gateway_routes_enable_delegate)

  if(!!process.env.gateway_routes_enable_mine)
    configs.routes.enable.mine = parseBool(process.env.gateway_routes_enable_mine)

  if(!!process.env.gateway_routes_enable_crash_report)
    configs.routes.enable.crashReport = parseBool(process.env.gateway_routes_enable_crash_report)

  if(!!process.env.gateway_routes_enable_find_ip)
    configs.routes.enable.findIp = parseBool(process.env.gateway_routes_enable_find_ip)

  return configs as GatewayGlobalConfigs;
}
