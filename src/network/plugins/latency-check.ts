import CallablePlugin from './base/callable-plugin.js';
import {remoteApp, remoteMethod} from "./base/app-decorators.js";
import {AppContext, AppDeploymentInfo, AppDeploymentStatus, MuonNodeInfo} from "../../common/types";
import {MapOf} from "../../common/mpc/types";
import * as CoreIpc from '../../core/ipc.js'
import NodeManagerPlugin from "./node-manager.js";
import {timeout} from "../../utils/helpers.js";
import {logger} from '@libp2p/logger'

const log = logger("muon:network:plugins:latency")

const RemoteMethods = {
  CheckHealth: 'check-health',
}

@remoteApp
export default class LatencyCheckPlugin extends CallablePlugin {
  private updateInterval: number = 30e3;
  /** seed => AppContext */
  private contexts: MapOf<AppContext> = {}
  /** nodeId => seed => boolean */
  private nodesWatchList: MapOf<MapOf<boolean>> = {}
  /** nodeId => latency */
  private latency: MapOf<number|null> = {};

  private lastUpdateTime: number = 0;

  async onInit() {
    await super.onInit();
  }

  async onStart() {
    await super.onStart();

    this.network.on("app-context:add", this.onAppContextAdd.bind(this))
    this.network.on("app-context:update", this.onAppContextUpdate.bind(this))
    this.network.on("app-context:delete", this.onAppContextDelete.bind(this))

    this.monitorAllContexts();
  }

  private get nodeManager(): NodeManagerPlugin {
    return this.network.getPlugin('node-manager');
  }

  initAppContext(context: AppContext) {
    let {seed, expiration} = context
    log(`initializing app context: ${seed}`);
    if((!expiration || Date.now() < expiration*1000) && context.party.partners.includes(this.nodeManager.currentNodeInfo!.id)) {
      this.addContextToWatchList(context);
    }
  }

  private addContextToWatchList(context: AppContext) {
    let {seed} = context;
    this.contexts[seed] = context
    for(const id of context.party.partners) {
      if(!this.nodesWatchList[id]) {
        this.nodesWatchList[id] = {}
      }
      this.nodesWatchList[id][seed] = true;
    }
  }

  private removeContextFromWatchList(context: AppContext) {
    let {seed} = context
    for(const id of context.party.partners) {
      if(!!this.nodesWatchList[id]) {
        delete this.nodesWatchList[id][seed]
      }
    }
    delete this.contexts[seed];
  }

  private async monitorAllContexts() {
    while (true) {
      /** remove expired context from monitor list */
      Object.keys(this.contexts).map(seed => {
        let ctx = this.contexts[seed];
        if(!!ctx.expiration && Date.now() > ctx.expiration*1000)
          this.removeContextFromWatchList(ctx)
      })

      /** update parties data */
      try {
        log("updating all nodes latency ...");

        const allNodes = Object.keys(this.nodesWatchList)
          .filter(nodeId => Object.keys(this.nodesWatchList[nodeId]).length > 0)

        let nodes: MuonNodeInfo[] = this.nodeManager.filterNodes({list: allNodes});
        const startTime = Date.now();

        let callResult: (number|null)[] = await Promise.all(
          nodes.map(n => {
            return (
              n.wallet === process.env.SIGN_WALLET_ADDRESS
                ?
                this.__checkHealth()
                :
                this.findPeer(n.peerId)
                  .then(peer => {
                      if(!peer)
                        throw {message: `peer not found ${n.peerId}`}
                      return this.remoteCall(
                        peer,
                        RemoteMethods.CheckHealth,
                        null,
                        {timeout: 4000}
                      )
                    }
                  )
            )
              .then(() => Date.now() - startTime)
              .catch(e => null)
          })
        )
        this.lastUpdateTime = startTime;
        this.latency = nodes.reduce((obj, n, i) => {
          obj[n.id] = callResult[i]
          return obj;
        }, {})
        log("nodes latency updated.");
      }
      catch (e) {
        log.error('error when updating latency data %o', e)
      }
      await timeout(this.updateInterval);
    }
  }

  async onAppContextAdd(context: AppContext) {
    let {seed} = context
    log(`adding context to monitor list. ${seed}`)
    this.initAppContext(context)
  }

  async onAppContextUpdate(context: AppContext) {
    let {seed} = context
    log(`updating context of monitor list. ${seed}`)
    this.initAppContext(context)
  }

  async onAppContextDelete(data: { contexts: AppContext[] }) {
    let {contexts=[]} = data;
    for(const ctx of contexts) {
      log(`deleting context from monitor list. ${ctx.seed}`)
      this.removeContextFromWatchList(ctx);
    }
  }

  getAppLatency(appId: string, seed: string): MapOf<number> {
    let context: AppContext = this.contexts[seed]
    if(!context)
      return {}
    return context.party.partners
      .reduce((obj, id) => {
        if(this.latency[id] !== undefined && this.latency[id] !== null)
          obj[id] = this.latency[id]
        return obj;
      }, {});
  }

  @remoteMethod(RemoteMethods.CheckHealth)
  async __checkHealth(): Promise<string> {
    return "OK"
  }
}
