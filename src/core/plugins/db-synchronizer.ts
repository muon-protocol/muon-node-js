import {gatewayMethod, remoteApp, remoteMethod} from "./base/app-decorators.js";
import PQueue from "p-queue";
import CallablePlugin from "./base/callable-plugin.js";
import AppManager from "./app-manager.js";
import NodeManagerPlugin from "./node-manager.js";
import * as NetworkIpc from "../../network/ipc.js";
import {AppContext, MuonNodeInfo} from "../../common/types";
import TssPlugin from "./tss-plugin.js";
import {timeout} from "../../utils/helpers.js";
import {logger} from '@libp2p/logger'

const CONCURRENT_TSS_RECOVERY = 2;
const log = logger("muon:core:plugins:synchronizer")

const RemoteMethods = {
  GetAllContexts: "get-all-ctx"
}

@remoteApp
export default class DbSynchronizer extends CallablePlugin {
  APP_NAME='synchronizer'
  private readonly recoveryQueue: PQueue;

  constructor(muon, configs) {
    super(muon, configs)

    this.recoveryQueue = new PQueue({
      concurrency: CONCURRENT_TSS_RECOVERY,
    });
  }

  async onStart(): Promise<void> {
    await super.onStart();
    log('onStart done.')
  }

  private get nodeManager(): NodeManagerPlugin {
    return this.muon.getPlugin('node-manager');
  }

  private get appManager(): AppManager {
    return this.muon.getPlugin('app-manager');
  }

  private get tssPlugin(): TssPlugin {
    return this.muon.getPlugin('tss-plugin')
  }

  @gatewayMethod("sync-db")
  async __syncDatabase() {
    log(`sync signal arrived ...`)
    let deployers: string[] = this.nodeManager
      .filterNodes({isDeployer: true})
      .map(({id}) => id)
    let onlineDeployers: string[] = await NetworkIpc.findNOnlinePeer(deployers, 2, {timeout: 4000, return: "peerId"})
    // @ts-ignore
    let allContexts: AppContext[] = await Promise.any(
      onlineDeployers.map(deployer => {
        return this.remoteCall(
          deployer,
          RemoteMethods.GetAllContexts
        )
      })
    )

    let contextToSave: AppContext[] = allContexts.filter(ctx => {
      return !this.appManager.hasContext(ctx)
    })

    log(`there is ${contextToSave.length} missing contexts: %o`, contextToSave.map(ctx => ctx.seed))

    /** save all new contexts */
    for(const ctx of contextToSave) {
      await this.appManager.saveAppContext(ctx);
    }

    /** wait for event propagation */
    await timeout(2000)

    /** recover app's tss keys */
    log(`starting ${contextToSave.length} tss key recovery ...`)
    await Promise.all(contextToSave.map(ctx => {
      return this.recoveryQueue.add(() => this.tryTssRecovery(ctx))
    }))
    log(`all ${contextToSave.length} tss key recovery done.`)
  }

  async tryTssRecovery(ctx: AppContext) {
    log(`starting key recovery app: ${ctx.appName}:${ctx.seed}`)
    const {appId, seed} = ctx
    for(let numTry=3 ; numTry > 0 ; numTry--) {
      await timeout(10000);
      try {
        const recovered = await this.tssPlugin.checkAppTssKeyRecovery(appId, seed, true);
        if(recovered) {
          log(`tss key for app: ${ctx.appName}:${ctx.seed} recovered successfully.`)
          break;
        }
      }
      catch (e) {
        log.error(`error when recovering tss key for app: ${ctx.appName}:${ctx.seed}. %O`, e)
      }
    }
  }

  @remoteMethod(RemoteMethods.GetAllContexts)
  async __getAllContexts(data, callerInfo: MuonNodeInfo): Promise<AppContext[]> {
    return this.appManager.getNodeAllContexts(callerInfo);
  }
}
