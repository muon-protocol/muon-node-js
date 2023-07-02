import BaseCronJob from "./base-cron-job.js";
import PQueue from "p-queue";
import {QueueProducer} from "../../../common/message-bus/index.js";
import AppManagerPlugin from "../app-manager.js";
import {AppContext} from "../../../common/types";
import {APP_STATUS_EXPIRED, APP_STATUS_PENDING} from "../../constants.js";
import {MapOf} from "../../../common/mpc/types";
import {GatewayCallParams} from "../../../gateway/types";
import {AnnounceCheckOptions, muonCall} from "../../../cmd/utils.js";
import {timeout} from "../../../utils/helpers.js";

const CONCURRENT_RESHARE = 5;
let requestQueue = new QueueProducer(`gateway-requests`);

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

  protected startDelay:number = 5e3;
  protected interval:number = 20e3;
  protected leadingPeriod: number = 20e3;
  protected leadingGap: number = 5e3;

  private readonly reshareQueue: PQueue;

  constructor(muon, configs) {
    super(muon, configs)

    this.reshareQueue = new PQueue({
      concurrency: CONCURRENT_RESHARE,
    });
  }

  private get appManager():AppManagerPlugin {
    return this.muon.getPlugin('app-manager')
  }

  async process() {
    let pendingContexts: AppContext[] = this.appManager.filterContexts({
      deploymentStatus: [APP_STATUS_PENDING, APP_STATUS_EXPIRED],
    })
    /** All context of pending Apps */
    const appsContexts: MapOf<AppContext[]> = {}
    for(const ctx of pendingContexts) {
      const {appId} = ctx;
      if(appsContexts[appId] === undefined) {
        appsContexts[appId] = this.appManager.filterContexts({appId});
      }
    }
    /** filter and keep, only contexts that not rotated */
    pendingContexts = pendingContexts.filter(ctx => {
      const {appId, seed} = ctx;
      let rotatedContext = appsContexts[appId].find(ctx2 => {
        return !!ctx2.previousSeed && ctx2.previousSeed === seed
      })
      return !rotatedContext;
    })

    this.log(`starting ${pendingContexts.length} apps key reshare ...`)
    await Promise.all(pendingContexts.map(ctx => {
      return this.reshareQueue.add(() => this.reshareApp(ctx))
    }))
    this.log(`all ${pendingContexts.length} reshare done.`)
  }

  async reshareApp(ctx: AppContext) {
    const {appId, seed} = ctx;

    this.log("calling random-seed request %o", {appId, seed});
    const randomSeedResponse = await requestQueue.send({
      app: 'deployment',
      method: `random-seed`,
      params: {
        appId,
        previousSeed: seed,
      }
    } as GatewayCallParams);
    if(!randomSeedResponse?.confirmed) {
      throw "random seed not confirmed"
    }
    this.log(`Random seed generated %o`, {randomSeed: randomSeedResponse.signatures[0].signature})

    this.log('Selecting new party ...')
    const reshareResponse = await requestQueue.send({
      app: 'deployment',
      method: `tss-rotate`,
      params: {
        appId,
        previousSeed: seed,
        seed:{
          value: randomSeedResponse.signatures[0].signature,
          reqId: randomSeedResponse.reqId,
          nonce: randomSeedResponse.data.init.nonceAddress,
        }
      }
    })
    if(!reshareResponse?.confirmed) {
      throw "rotation request not confirmed"
    }
    this.log(`Party select tx ${reshareResponse.reqId}.`)

    this.log(`Party select confirmation waiting ...`);
    await this.waitToRequestBeAnnounced(reshareResponse, {checkAllGroups: true});

    this.log('Generating app tss key ...')
    const keyGenResponse = await requestQueue.send({
      app: `deployment`,
      method: "tss-reshare",
      params: {
        appId,
        seed: reshareResponse.data.result.seed,
      }
    })
    if(!keyGenResponse?.confirmed) {
      throw "key-gen request not confirmed"
    }
    this.log(`Reshare tx ${keyGenResponse.reqId}.`)
    this.log(`Reshare confirmation waiting ...`);
    await this.waitToRequestBeAnnounced(keyGenResponse, {checkAllGroups: true});
    this.log(
      `TSS key resharing done with this generators: [${keyGenResponse.data.init.keyGenerators}]. %O`,
      keyGenResponse.data.result
    )
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

      const check = await requestQueue.send({
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
