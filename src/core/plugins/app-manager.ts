import BasePlugin from './base/base-plugin'
import TimeoutPromise from "../../common/timeout-promise";
const AppContext = require("../../common/db-models/AppContext")
const AppTssConfig = require("../../common/db-models/AppTssConfig")

const appContextEventEmitter = AppContext.watch()
const appTssConfigEventEmitter = AppTssConfig.watch()

export default class AppManager extends BasePlugin {
  private appContexts: {[index: string]: any} = {}
  private appTssConfigs: {[index: string]: any} = {}
  private loading: TimeoutPromise = new TimeoutPromise();

  async onStart() {
    this.loadAppsInfo()

    appContextEventEmitter.on('change', this.onAppContextChange.bind(this))
    appTssConfigEventEmitter.on('change', this.onAppTssConfigChange.bind(this))
  }

  async loadAppsInfo() {
    try {
      const contextMap: {[index: string]: any} = {}
      const allAppContexts = await AppContext.find({});
      allAppContexts.forEach(ac => {
        this.appContexts[ac.appId] = ac;
        contextMap[ac._id] = ac
      })

      const allTssKeys = await AppTssConfig.find({});
      allTssKeys.forEach(key => {
        const ac = contextMap[key.context];
        this.appTssConfigs[ac.appId] = key;
      })

      this.loading.resolve(true);
    }catch (e) {
      console.log(`AppManager.loadAppsInfo`, e);
    }
  }

  async onAppContextChange(change) {
    console.log("====== AppContext:change ======", JSON.stringify(change))
    switch (change.operationType) {
      case "insert": {
        break
      }
      case "replace": {
        break
      }
      case "delete": {
        break
      }
      default:
        console.log(`AppManager.onAppContextChange`, change)
    }
  }

  async onAppTssConfigChange(change) {
    // console.log("====== AppTssConfig:change ======", JSON.stringify(change))
    switch (change.operationType) {
      case "insert": {
        break
      }
      case "replace": {
        break
      }
      case "delete": {
        let documentId = change.documentKey._id;
        try {
          await this.emit("app-tss:delete", documentId)
        }
        catch (e) {
          console.log(`AppManager.onAppTssConfigChange`, e);
        }
        break
      }
      default:
        console.log(`AppManager.onAppContextChange`, change)
    }
  }

  appIsDeployed(appId: string): boolean {
    return !!this.appContexts[appId]
  }

  getAppContext(appId: string) {
    return this.appContexts[appId]
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
