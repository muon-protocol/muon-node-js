import Muon, { MuonPlugin, MuonPluginConfigs } from "./muon.js";
import mongoose from "mongoose"
import path from "path"
import fs from "fs"
import { dynamicExtend } from "./utils.js"
import { fileCID } from "../utils/cid.js"
import BaseApp from "./plugins/base/base-app-plugin.js";
import "./global.js"
import loadConfigs from "../network/configurations.js"
import Web3 from 'web3'
import chalk from "chalk"
import { Constructor } from "../common/types";
import BasePlugin from "./plugins/base/base-plugin.js";
import Log from "../common/muon-log.js"
import { createRequire } from "module";
import {filePathInfo} from "../utils/helpers.js";

const {__dirname} = filePathInfo(import.meta)
const {utils: { sha3 }} = Web3
const log = Log("muon:core");

const muonAppRequire = createRequire(import.meta.url);
// override .js loader
muonAppRequire.extensions[".js"] = function(module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  // @ts-ignore
  module._compile(content, filename);
};

async function getEnvPlugins(): Promise<MuonPlugin[]> {
  let pluginsStr = process.env["MUON_PLUGINS"];
  if (!pluginsStr) return [];
  let result: MuonPlugin[] = [];
  for (let key of pluginsStr.split("|")) {
    result.push({
      name: `__${key}__`,
      module: (await import(`./plugins/${key}`)).default,
      config: {},
    });
  }
  return result;
}

function isV3(app) {
  return !!app.signParams;
}

function prepareApp(app, fileName, isBuiltInApp = false, filePath = "")
  : [Constructor<BasePlugin>, MuonPluginConfigs] {
  if (!app.APP_ID) {
    if (isV3(app)) {
      app.APP_ID = sha3(fileName);
    } else {
      log(
        chalk.yellow(
          `Deprecated app version: ${app.APP_NAME} app has old version and need to upgrade to v3.`
        )
      );
      // @ts-ignore
      app.APP_ID = "0x" + sha3(fileName).slice(-8);
    }
  }

  app.APP_ID = BigInt(app.APP_ID).toString(10);
  app.isBuiltInApp = isBuiltInApp;
  if (filePath) {
    app.APP_CID = fileCID(filePath);
  }
  return [dynamicExtend(BaseApp, app), {}];
}

function loadApp(path) {
  try {
    muonAppRequire.resolve(path);
    return muonAppRequire(path);
  } catch (e) {
    console.error(chalk.red(`Error when loading app from path [${path}]`));
    console.error(e);
    return undefined;
  }
}

function getCustomApps(): MuonPlugin[] {
  let pluginsStr = process.env["MUON_CUSTOM_APPS"];
  if (!pluginsStr) return [];
  let result: MuonPlugin[] = [];
  pluginsStr.split("|").forEach((name) => {
    let appPath = `../../apps/custom/${name}`;
    let app = loadApp(appPath);
    if (app && !!app.APP_NAME) {
      const [module, config] = prepareApp(
        app,
        `${name}.js`,
        false,
        path.join(__dirname, `${appPath}.js`)
      );
      result.push({ name, module, config });
    }
  });
  return result;
}

function getBuiltInApps(): MuonPlugin[] {
  const appDir = path.join(__dirname, "../built-in-apps");
  let result: MuonPlugin[] = [];
  let files = fs.readdirSync(appDir);
  for(let i=0 ; i<files.length ; i++) {
    const file = files[i]
    let ext = file.split(".").pop();
    if (ext && ext.toLowerCase() === "js") {
      let app = loadApp(`../built-in-apps/${file}`);
      if (app && !!app.APP_NAME) {
        const [module, config] = prepareApp(app, file, true);
        result.push({ name: app.APP_NAME, module, config });
      }
    }
  };
  return result;
}

function getGeneralApps(): MuonPlugin[] {
  const appDir = path.join(__dirname, "../../apps/general");
  let result: MuonPlugin[] = [];
  let files = fs.readdirSync(appDir);
  files.forEach((file) => {
    let ext = file.split(".").pop();
    if (ext && ext.toLowerCase() === "js") {
      let appPath = `../../apps/general/${file}`;
      let app = loadApp(appPath);
      if (app && !!app.APP_NAME) {
        const [module, config] = prepareApp(app, file,
          false, path.join(__dirname, `${appPath}`));
        result.push({ name: app.APP_NAME, module, config });
      }
    }
  });
  return result;
}

var muon;

async function start() {
  log("starting ...");
  await mongoose.connect(process.env.MONGODB_CS!, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  if (!mongoose.connection) throw "Error connecting to MongoDB";

  log(`MongoDB successfully connected.`);

  let config = await loadConfigs();
  let { net, tss } = config;
  try {
    // const nodeVersion = process.versions.node.split('.');
    // if(nodeVersion[0] < '16')
    //   throw {message: `Node version most be >="16.0.0". current version is "${process.versions.node}"`}
    muon = new Muon({
      plugins: [
        {
          name: "collateral",
          module: (await import("./plugins/collateral-info.js")).default,
          config: {},
        },
        {
          name: "app-manager",
          module: (await import("./plugins/app-manager.js")).default,
          config: {},
        },
        {
          name: "remote-call",
          module: (await import("./plugins/remote-call.js")).default,
          config: {},
        },
        {
          name: "gateway-interface",
          module: (await import("./plugins/gateway-Interface.js")).default,
          config: {},
        },
        {
          name: "ipc",
          module: (await import("./plugins/core-ipc-plugin.js")).default,
          config: {},
        },
        {
          name: "ipc-handlers",
          module: (await import("./plugins/core-ipc-handlers.js")).default,
          config: {},
        },
        {
          name: "broadcast",
          module: (await import("./plugins/broadcast.js")).default,
          config: {},
        },
        {
          name: "content-verify",
          module: (await import("./plugins/content-verify-plugin.js")).default,
          config: {},
        },
        {
          name: "content",
          module: (await import("./plugins/content-app.js")).default,
          config: {},
        },
        {
          name: "memory",
          module: (await import("./plugins/memory-plugin.js")).default,
          config: {},
        },
        {
          name: "tss-plugin",
          module: (await import("./plugins/tss-plugin.js")).default,
          config: {},
        },
        {
          name: "health-check",
          module: (await import("./plugins/health-check.js")).default,
          config: {},
        },
        {
          name: "explorer",
          module: (await import("./plugins/explorer.js")).default,
          config: {},
        },
        {
          name: "dht",
          module: (await import("./plugins/dht.js")).default,
          config: {},
        },
        {
          name: "system",
          module: (await import("./plugins/system.js")).default,
          config: {},
        },
        {
          name: "mpc",
          module: (await import("./plugins/mpc-runner.js")).default,
          config: {},
        },
        {
          name: "mpcnet",
          module: (await import("./plugins/mpc-network.js")).default,
          config: {},
        },
        ...(await getEnvPlugins()),
        ...getCustomApps(),
        ...getGeneralApps(),
        ...getBuiltInApps(),
      ],
      net,
      // TODO: pass it into the tss-plugin
      tss,
    });

    await muon.initialize();

    muon.start();
  } catch (e) {
    console.error(e);
    throw e;
  }
}

export {
  start,
};
