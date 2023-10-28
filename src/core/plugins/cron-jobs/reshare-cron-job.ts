import BaseCronJob from "./base-cron-job.js";
import PQueue from "p-queue";
import AppManagerPlugin from "../app-manager.js";
import {AppContext, AppDeploymentStatus} from "../../../common/types";
import {APP_STATUS_DEPLOYED, APP_STATUS_EXPIRED, APP_STATUS_PENDING} from "../../constants.js";
import {MapOf} from "../../../common/mpc/types";
import {GatewayCallParams} from "../../../gateway/types";
import {AnnounceCheckOptions, muonCall} from "../../../cmd/utils.js";
import {getTimestamp, timeout} from "../../../utils/helpers.js";
import * as crypto from "../../../utils/crypto.js";
import {enqueueAppRequest} from "../../ipc.js";
import { reportReshareFailure } from "../../../common/analitics-reporter.js";
import { DEPLOYMENT_APP_ID, GENESIS_SEED } from "../../../common/contantes.js";
import System from "../system.js";

const CONCURRENT_RESHARE = 5;

function isRequestAnnounced(explorerResult, options:AnnounceCheckOptions={}) {
  // console.dir(check, {depth: 6});
  if(explorerResult?.isValid === false)
    throw `invalid request`

  if(options.checkAllGroups) {
    if(explorerResult?.allGroupsAnnounced) {
      return true
    }
  }
  else {
    if(explorerResult?.appPartyAnnounced)
      return true;
  }
  return false
}

export default class ReshareCronJob extends BaseCronJob{

  protected startDelay:number = 10e3;
  protected interval:number = 30e3;
  protected leadingPeriod: number = 300e3;
  protected leadingGap: number = 30e3;

  private readonly rotateQueue: PQueue;

  constructor(muon, configs) {
    super(muon, configs)

    this.rotateQueue = new PQueue({
      concurrency: CONCURRENT_RESHARE,
    });
  }

  private get appManager():AppManagerPlugin {
    return this.muon.getPlugin('app-manager')
  }

  private get SystemPlugin():System {
    return this.muon.getPlugin('system')
  }

  async process() {
    await this.checkDeploymentInitialization();
    
    let pendingContexts: AppContext[] = this.appManager.filterContexts({
      deploymentStatus: [APP_STATUS_PENDING, APP_STATUS_EXPIRED],
      custom: ctx => ctx.rotationEnabled === true
    })
    /** filter and keep, only contexts that not rotated */
    pendingContexts = pendingContexts.filter(ctx => {
      return !this.appManager.isSeedReshared(ctx.seed);
    })

    const ctxMap:MapOf<AppContext> = pendingContexts.reduce((obj:MapOf<AppContext>, curr: AppContext): MapOf<AppContext> => {
      let {appId} = curr;
      if(obj[appId] === undefined) {
        obj[appId] = curr;
      }
      else {
        if(curr.deploymentRequest?.data.result.timestamp > obj[appId].deploymentRequest?.data.result.timestamp)
          obj[appId] = curr;
      }
      return obj;
    }, {})

    this.log("reshare contexts: %o", {
      pending: pendingContexts.map(c => ({app: c.appName, seed: c.seed})),
      reshare: Object.values(ctxMap).map(c => ({app: c.appName, seed: c.seed})),
    })

    pendingContexts = Object.values(ctxMap);

    this.log(`starting ${pendingContexts.length} apps key reshare ...`)
    await Promise.all(pendingContexts.map(ctx => {
      return this.rotateQueue.add(() => this.reshareAppContext(ctx).catch(e => {
        let {message, ...otherErrorParams} = e;
        if(typeof e === "string")
          message = e;
        reportReshareFailure({
          leader: this.currentNodeInfo!.id,
          appInfo: {appName: ctx.appName, seed: ctx.seed},
          error: {
            message,
            ...otherErrorParams,
          }
        })
          .catch(e => this.log("error when reporting reshare failure to the server %o", e));
        this.log.error("reshare failed %o error: %o", {app: ctx.appName, seed: ctx.seed}, e)
      }))
    }))

    this.log(`all ${pendingContexts.length} reshare done.`)
  }

  async checkDeploymentInitialization() {
    const lastDeploymentContext = this.appManager.getAppLastContext(DEPLOYMENT_APP_ID)!;
    const {appId, seed} = lastDeploymentContext;
    const lastDeploymentStatus:AppDeploymentStatus = this.appManager.getAppDeploymentStatus(appId, seed);
    this.log(`deployment status: %o`, {lastDeploymentStatus, seed});
    if(seed === GENESIS_SEED && lastDeploymentStatus !== APP_STATUS_DEPLOYED) {
      await this.SystemPlugin.initializeGenesisKey()
      return;
    }
    else if(lastDeploymentStatus === APP_STATUS_EXPIRED) {
      const genesisStatus = this.appManager.getAppDeploymentStatus(DEPLOYMENT_APP_ID, GENESIS_SEED)
      if(genesisStatus !== APP_STATUS_DEPLOYED) {
        await this.SystemPlugin.initializeGenesisKey()
      }
      return;
    }
  }

  /**
   * @param ctx {AppContext} - The context that needs to rotate
   * @return {AppContext} - The rotated context of App (The new context)
   */
  async reshareAppContext(ctx: AppContext): Promise<AppContext> {
    const {appId, seed} = ctx;

    this.log("calling random-seed request %o", {appId, seed});
    const randomSeedResponse = await enqueueAppRequest({
      app: 'deployment',
      method: `random-seed`,
      params: {
        appId,
        previousSeed: seed,
      }
    } as GatewayCallParams)
      .catch(e => {
        this.log.error("random-seed failed %o", e)
        throw e;
      });
    if(!randomSeedResponse?.confirmed) {
      this.log.error("random-seed failed %o", randomSeedResponse)
      throw {message: "random seed failed", request: randomSeedResponse};
    }
    this.log(`Random seed generated %o`, {randomSeed: randomSeedResponse.signatures[0].signature})

    this.log('resharing the app ...')
    const leaderSignature = crypto.sign(randomSeedResponse.signatures[0].signature)
    const reshareResponse = await enqueueAppRequest({
      app: 'deployment',
      method: `reshare`,
      params: {
        appId,
        previousSeed: seed,
        seed:{
          value: randomSeedResponse.signatures[0].signature,
          reqId: randomSeedResponse.reqId,
          nonce: randomSeedResponse.data.init.nonceAddress,
        },
        leaderSignature,
      }
    })
      .catch(e => {
        this.log.error(`tss-rotate request failed %o`, e);
        throw e;
      })
    if(!reshareResponse?.confirmed) {
      throw {message: "reshare request not confirmed", request: reshareResponse}
    }
    this.log(`Reshare tx ${reshareResponse.reqId}.`)

    this.log(`Reshare confirmation waiting ...`);
    await this.waitToRequestBeAnnounced(reshareResponse, {checkAllGroups: true});

    return this.appManager.getSeedContext(reshareResponse.data.result.seed)!;
  }

  async waitToRequestBeAnnounced(request: any, options?:AnnounceCheckOptions) {
    const configs = {
      announceTimeout: 3*60e3,
      checkAllGroups: false,
      ...options
    };
    let confirmed = false;
    const checkStartTime = Date.now()
    let n = 0;
    while (!confirmed) {
      n++;
      /**
       wait to request confirmed by app party
       will timeout after 3 minutes
       */
      if(Date.now()-checkStartTime > configs.announceTimeout)
        throw `request confirmation timed out`;

      /** check every 5 seconds */
      await timeout(n === 1 ? 1000 : 5000);

      const check = await enqueueAppRequest({
        app: 'explorer',
        method: 'req-check',
        params: {request}
      })

      confirmed = isRequestAnnounced(check);

      if(!confirmed)
        this.log(`not announced yet. %o`, request.reqId);
    }
    this.log('request confirmed by app party %o', request.reqId)
  }
}
