import BasePlugin from './base/base-plugin'
import TimeoutPromise from "../../common/timeout-promise";
const AppContext = require("../../common/db-models/AppContext")
const AppTssConfig = require("../../common/db-models/AppTssConfig")

const appContextEventEmitter = AppContext.watch()
const appTssConfigEventEmitter = AppTssConfig.watch()

export default class AppManager extends BasePlugin {
  private appContexts: {[index: string]: any} = {}
  private contextIdToAppIdMap: {[index: string]: string}={}
  private appTssConfigs: {[index: string]: any} = {}
  private loading: TimeoutPromise = new TimeoutPromise();

  async onStart() {
    this.loadAppsInfo()

    appContextEventEmitter.on('change', this.onAppContextChange.bind(this))
    appTssConfigEventEmitter.on('change', this.onAppTssConfigChange.bind(this))
  }

  async loadAppsInfo() {
    try {
      const allAppContexts = await AppContext.find({});
      allAppContexts.forEach(ac => {
        this.appContexts[ac.appId] = ac;
        this.contextIdToAppIdMap[ac._id] = ac.appId
      })

      const allTssKeys = await AppTssConfig.find({});
      allTssKeys.forEach(key => {
        const appId = this.contextIdToAppIdMap[key.context];
        this.appTssConfigs[appId] = key;
      })

      this.loading.resolve(true);
    }catch (e) {
      console.log(`AppManager.loadAppsInfo`, e);
    }
  }

  async onAppContextChange(change) {
    // console.log("====== AppContext:change ======", JSON.stringify(change))
    switch (change.operationType) {
      case "insert": {
        const doc = change.fullDocument;
        this.appContexts[doc.appId] = doc;
        this.contextIdToAppIdMap[doc._id] = doc.appId
        break
      }
      // case "replace": {
      //   break
      // }
      // case "delete": {
      //   break
      // }
      default:
        console.log(`AppManager.onAppContextChange`, change)
    }
  }

  async onAppTssConfigChange(change) {
    // console.log("====== AppTssConfig:change ======", JSON.stringify(change))
    switch (change.operationType) {
      case "insert": {
        const doc = change.fullDocument;
        const appId = this.contextIdToAppIdMap[doc.context];
        this.appTssConfigs[appId] = doc;
        break
      }
      case "replace": {
        const doc = change.fullDocument;
        const appId = this.contextIdToAppIdMap[doc.context];
        this.appTssConfigs[appId] = doc;

        try {
          /** TssPlugin needs to refresh tss key info */
          await this.emit("app-tss:delete", appId, doc)
        }
        catch (e) {
          console.log(`AppManager.onAppTssConfigChange`, e);
        }
        break
      }
      case "delete": {
        let documentId = change.documentKey._id.toString();
        try {
          const appId = Object.keys(this.appTssConfigs).find(appId => (this.appTssConfigs[appId]._id.toString() === documentId))
          if(!appId) {
            console.error(`AppTssConfig deleted but appId not found`, change)
            return
          }
          const appTssConfig = this.appTssConfigs[appId]
          delete this.appTssConfigs[appId]
          await this.emit("app-tss:delete", appId, appTssConfig)
        }
        catch (e) {
          console.log(`AppManager.onAppTssConfigChange`, e);
        }
        break
      }
      default:
        console.log(`AppManager.onAppContextChange`, JSON.stringify(change))
    }
  }

  appIsDeployed(appId: string): boolean {
    return !!this.appContexts[appId]
  }

  getAppContext(appId: string) {
    return this.appContexts[appId];
  }

  appHasTssKey(appId: string): boolean {
    return !!this.appTssConfigs[appId];
  }

  getAppTssKey(appId: string) {
    return this.appTssConfigs[appId];
  }

  isLoaded() {
    return this.loading.isFulfilled;
  }

  waitToLoad() {
    return this.loading.promise;
  }
}
