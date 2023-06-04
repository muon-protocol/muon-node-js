import axios, {AxiosRequestConfig} from "axios";
import {muonSha3} from "../utils/sha3.js";
import * as crypto from "../utils/crypto.js";
import {MapOf} from "./mpc/types";
import {logger} from "@libp2p/logger"

const log = logger('muon:analytic:reporter')

const BaseUrls = [
  "https://testnet.muon.net",
  // "http://localhost:8000",
]

const axiosConfigs: AxiosRequestConfig = {
  timeout: 3000
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
  return Promise.all(BaseUrls.map(url => axios.post(`${url}/analytics/crash/report`, report, axiosConfigs)))
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
  return Promise.all(BaseUrls.map(url => axios.post(`${url}/analytics/insufficient/report`, report, axiosConfigs)))
}
