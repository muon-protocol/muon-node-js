import axios, {AxiosRequestConfig} from "axios";
import {muonSha3} from "../utils/sha3.js";
import * as crypto from "../utils/crypto.js";
import {MapOf} from "./mpc/types";
import {logger} from "@libp2p/logger"
import loadNetworkConfigs from '../network/configurations.js'
import {NetConfigs} from "./types";
import { GatewayCallMode, GatewayCallParams } from "../gateway/types.js";

const log = logger('muon:analytic:reporter')

let netConfigs:NetConfigs;

const axiosConfigs: AxiosRequestConfig = {
  timeout: 3000
}

async function getConfigs(): Promise<NetConfigs> {
  if(!netConfigs) {
    const configs = await loadNetworkConfigs()
    netConfigs = configs.net;
  }
  return netConfigs;
}

export type CrashAnalyticData = {
  timestamp: number,
  wallet: string,
  cluster: string,
  error: {
    reason: any,
    stack: any
  },
  signature: string,
}

export async function reportCrash(reportData: Omit<CrashAnalyticData, "signature" | "wallet" | "timestamp">) {
  const netConfigs = await getConfigs();
  if((netConfigs.analytics?.baseUrls || []).length < 1)
    return;
  const baseUrls:string[] = netConfigs.analytics!.baseUrls!;

  const report = {
    timestamp: Date.now(),
    wallet: process.env.SIGN_WALLET_ADDRESS,
    ...reportData,
    signature: ""
  }
  log('reporting crash to muon servers ...')
  const hash = muonSha3(
    {t: 'uint64', v: report.timestamp},
    {t: 'address', v: report.wallet},
    {t: 'string', v: 'crash-report'},
  );
  // @ts-ignore
  report.signature = crypto.sign(hash)
  log("crash report data", report)
  return Promise.all(baseUrls.map(url => axios.post(`${url}/analytics/crash/report`, report, axiosConfigs)))
}

export type ConfirmFailureAnalyticData = {
  timestamp: number,
  wallet: string,
  signature: string,
  callInfo: {
    app: string,
    method: string,
    params: any
  },
  reqId: string,
  partners: string[],
  shareHolders: string[],
  confirmErrors: MapOf<string>
}

export async function reportConfirmFailure(reportData: Omit<ConfirmFailureAnalyticData, "timestamp" | "wallet" | "signature">) {
  const netConfigs = await getConfigs();
  if((netConfigs.analytics?.baseUrls || []).length < 1)
    return;
  const baseUrls:string[] = netConfigs.analytics!.baseUrls!;

  const report = {
    timestamp: Date.now(),
    wallet: process.env.SIGN_WALLET_ADDRESS,
    signature: "",
    ...reportData,
  }
  log('reporting confirm failure to muon servers ...')
  const hash = muonSha3(
    {t: 'uint64', v: report.timestamp},
    {t: 'address', v: report.wallet},
    {t: 'string', v: 'confirm-failure-report'},
  );
  // @ts-ignore
  report.signature = crypto.sign(hash)
  log("confirm failure report data", report)
  return Promise.all(baseUrls.map(url => axios.post(`${url}/analytics/confirm/report`, report, axiosConfigs)))
}

export type InsufficientPartnersAnalyticData = {
  timestamp: number,
  wallet: string,
  count: number,
  graph: MapOf<MapOf<number>>,
  minGraph: MapOf<MapOf<number>>,
  signature: string
}

export async function reportInsufficientPartners(reportData: Omit<InsufficientPartnersAnalyticData, "timestamp" | "wallet" | "signature">) {
  const netConfigs = await getConfigs();
  if((netConfigs.analytics?.baseUrls || []).length < 1)
    return;
  const baseUrls:string[] = netConfigs.analytics!.baseUrls!;

  const report = {
    timestamp: Date.now(),
    wallet: process.env.SIGN_WALLET_ADDRESS!,
    ...reportData,
    signature: ""
  }
  log('reporting insufficient partners data to muon servers ...')
  const hash = muonSha3(
    {t: 'uint64', v: report.timestamp},
    {t: 'address', v: report.wallet},
    {t: 'string', v: 'insufficient-partners-report'},
  );
  // @ts-ignore
  report.signature = crypto.sign(hash)
  log("insufficient partners report data", report)
  return Promise.all(baseUrls.map(url => axios.post(`${url}/analytics/insufficient/report`, report, axiosConfigs)))
}
