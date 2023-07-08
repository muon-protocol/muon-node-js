import BasePlugin from "../base/base-plugin.js";
import NodeManagerPlugin from "../node-manager.js";
import * as NetworkIpc from "../../../network/ipc.js";
import {timeout} from "../../../utils/helpers.js";
import {logger, Logger} from '@libp2p/logger'
import {MuonNodeInfo} from "../../../common/types";
import {muonSha3} from "../../../utils/sha3.js";

export default class BaseCronJob extends BasePlugin {

  /** default start delay: 20 Seconds */
  protected startDelay: number = 20e3;

  /** default process interval: 1 Hour */
  protected interval: number = 3600e3;

  /** default leading period: 30 Minutes */
  protected leadingPeriod: number = 1800e3;

  /** The span of time that has no leader between two adjacent leading periods. default: 5 Minutes */
  protected leadingGap: number = 300e3;

  protected log: Logger;

  private get nodeManager():NodeManagerPlugin {
    return this.muon.getPlugin("node-manager");
  }

  async onInit(): Promise<any> {
    await super.onInit();

    this.log = logger(`muon:core:jobs:${this.ConstructorName}`)
  }

  async onStart(): Promise<void> {
    await super.onStart();

    if (await NetworkIpc.askClusterPermission(`run-cron-job-${this.ConstructorName}`)) {
      this.mainLoop()
        .catch(e => console.log(e))
    }
  }

  private async mainLoop() {
    const {startDelay, interval} = this;
    this.log("main loop start %o", {startDelay, interval})
    await timeout((0.5 + Math.random()) * startDelay)
    while (true) {
      let currentNode: MuonNodeInfo|undefined = this.nodeManager.currentNodeInfo;
      if(currentNode && currentNode?.isDeployer && this.getLeader() === currentNode.id && this.process !== undefined) {
        try {
          await this.process();
        }
        catch (e) {
          this.log.error(`main loop error %o`, e);
        }
      }
      await timeout((0.5 + Math.random()) * interval)
    }
  }

  /**
   * Who is the leader
   * @return {string} - nodeId of the leader
   */
  getLeader(): string {
    let timestamp: number = Date.now();

    /** There is no leader in the leading gap. */
    if(timestamp % this.leadingPeriod < this.leadingGap)
      return "0"

    const periodIndex = Math.floor(timestamp / this.leadingPeriod);
    let deployers: string[] = this.nodeManager.filterNodes({isDeployer: true}).map(n => n.id);
    /** sort deployers*/
    deployers = deployers
      /** use a hash function to choose a different leader for each cron job. */
      .map(id => {
        return {
          id,
          hash: muonSha3(
            {t: "uint64", v: id},
            {t: "string", v: this.ConstructorName},
          )
        }
      })
      .sort((a, b) => (a.hash < b.hash ? 1 : -1))
      .map(n => n.id)
    return deployers[periodIndex % deployers.length];
  }

  async process() {}
}
