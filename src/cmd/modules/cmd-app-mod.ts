import assert from 'node:assert/strict';
import {muonCall, waitToRequestBeAnnounced} from '../utils.js'
import {getConfigs} from "./cmd-conf-mod.js";
import {AppDeploymentStatus} from "../../common/types";
import {APP_STATUS_EXPIRED, APP_STATUS_PENDING, APP_STATUS_TSS_GROUP_SELECTED} from "../../core/constants.js";

function expectConfirmed(response) {
  try {
    assert.equal(response?.success, true, "request not succeeded")
    assert.equal(response?.result?.confirmed, true, "request not confirmed")
  }catch (e) {
    console.dir(response, {depth: null})
    throw e
  }
}

export const command = 'app <action> <app>'

export const describe = 'Deploy/re-share app tss'

export const builder = {
  action: {
    describe: "action",
    choices: ['deploy', 'undeploy', 'reshare'],
    type: 'string',
  },
  app: {
    describe: "App name to do action on it.",
    type: "string"
  }
}

export async function handler(argv) {
  const configs = getConfigs();
  if(!configs.url)
    throw `Please set muon api url config`;
  const {action} = argv;

  switch (action) {
    case 'deploy': {
      await deployApp(argv, configs)
      break;
    }
    case 'undeploy': {
      await undeployApp(argv, configs)
      break;
    }
    case "reshare": {
      await reshareApp(argv, configs)
      break;
    }
  }
}

async function deployApp(argv, configs) {
  const {app, nodes, t, n, ttl, pending} = argv;
  console.log('retrieving app ID ...')
  const statusResult = await muonCall(configs.url, {
    app: 'explorer',
    method: "app",
    params: {
      appName: app,
    }
  })
  const appStatus: AppDeploymentStatus = statusResult?.result?.status
  const appId = statusResult?.result?.appId
  if (!appStatus) {
    console.log(statusResult);
    throw "Error when retrieving app info";
  }

  console.log('App Id is ', appId);

  if(appStatus === "DEPLOYED")
    throw `App already deployed`;
  let deploymentSeed: string;

  if(appStatus === 'NEW') {
    console.log(`random seed generating ...`)
    const randomSeedResponse = await muonCall(configs.url, {
      app: 'deployment',
      method: `random-seed`,
      params: {
        appId
      }
    })
    expectConfirmed(randomSeedResponse)
    console.log(`random seed generated`, {randomSeed: randomSeedResponse.result.signatures[0].signature})

    console.log('deploying ...')
    deploymentSeed = randomSeedResponse.result.signatures[0].signature
    const deployResponse = await muonCall(configs.url, {
      app: 'deployment',
      method: `deploy`,
      params: {
        appId,
        seed:{
          value: deploymentSeed,
          reqId: randomSeedResponse.result.reqId,
          nonce: randomSeedResponse.result.data.init.nonceAddress,
        },
        nodes: !!nodes ? nodes.split(',') : undefined,
        t,
        n,
        ttl,
        pendingPeriod: pending,
      }
    })
    expectConfirmed(deployResponse)
    console.log(`deployment tx ${deployResponse.result.reqId}.`)

    console.log(`deployment confirmation waiting ...`);
    await waitToRequestBeAnnounced(configs.url, deployResponse.result, {checkAllGroups: true});
  }
  else if(appStatus === "TSS_GROUP_SELECTED") {
    let context = statusResult?.result.contexts.find(ctx => ctx.status === "TSS_GROUP_SELECTED")
    deploymentSeed = context.seed
  }
  else {
    throw `Unknown App status ${appStatus}`
  }

  console.log('generating app tss key ...')
  const tssResponse = await muonCall(configs.url, {
    app: `deployment`,
    method: "tss-key-gen",
    params: {
      appId,
      seed: deploymentSeed,
    }
  })
  expectConfirmed(tssResponse)
  console.log(`keygen tx ${tssResponse.result.reqId}.`)

  console.log(`keygen confirmation waiting ...`);
  await waitToRequestBeAnnounced(configs.url, tssResponse.result);
  console.log(`tss key generating done with this generators: [${tssResponse.result.data.init.keyGenerators}].`, tssResponse.result.data.result)

}

async function undeployApp(argv, configs) {
  const {app} = argv;
  let deployers = ["http://127.0.0.1:8000/v1/", "http://127.0.0.1:8001/v1/"];

  for (let i = 0; i < deployers.length; i++) {
    let deployer = deployers[i];
    let statusResult = await muonCall(deployer, {
      app: 'deployment',
      method: `undeploy`,
      params: {
        app: app,
      }
    });
    console.log(deployer, statusResult);
  }
}

async function reshareApp(argv, configs) {
  const {app, nodes, n, ttl, pending} = argv;
  console.log('Retrieving app ID ...')
  const statusResult = await muonCall(configs.url, {
    app: 'explorer',
    method: "app",
    params: {
      appName: app,
    }
  })
  const {success, result: {appId, appName, contexts=[]}} = statusResult;
  if(!success || !appId) {
    console.log(`Unable to get App info`)
    return ;
  }

  /** find a pending context that has no rotated context. */
  const contextToRotate = contexts.find(ctx1 => {
    if(ctx1.status === APP_STATUS_PENDING || ctx1.status === APP_STATUS_EXPIRED) {
      let rotatedContext = contexts.find(ctx2 => {
        return !!ctx2.previousSeed && ctx2.previousSeed === ctx1.seed
      })
      /** ignore context that rotated */
      return !rotatedContext;
    }
    else
      return false
  })
  let keyGenSeed: any = null;
  if(!!contextToRotate) {
    console.log(`Rotation is needed for a context.`)
    console.log(`Random seed generating ...`)
    const randomSeedResponse = await muonCall(configs.url, {
      app: 'deployment',
      method: `random-seed`,
      params: {
        appId,
        previousSeed: contextToRotate.seed,
      }
    })
    expectConfirmed(randomSeedResponse)
    console.log(`Random seed generated`, {randomSeed: randomSeedResponse.result.signatures[0].signature})

    console.log('Selecting new party ...')
    const reshareSeed = randomSeedResponse.result.signatures[0].signature
    const reshareResponse = await muonCall(configs.url, {
      app: 'deployment',
      method: `tss-rotate`,
      params: {
        appId,
        previousSeed: contextToRotate.seed,
        seed:{
          value: reshareSeed,
          reqId: randomSeedResponse.result.reqId,
          nonce: randomSeedResponse.result.data.init.nonceAddress,
        },
        nodes: !!nodes ? nodes.split(',') : undefined,
        n,
        ttl,
        pendingPeriod: pending,
      }
    })
    expectConfirmed(reshareResponse)
    console.log(`Party select tx ${reshareResponse.result.reqId}.`)

    console.log(`Party select confirmation waiting ...`);
    await waitToRequestBeAnnounced(configs.url, reshareResponse.result, {checkAllGroups: true});

    keyGenSeed = reshareResponse.result.data.result.seed;
  }
  else {
    console.log("Rotation is not needed for any context.")
    /** If there is no PENDING context, find a context to KeyGen */
    const groupSelectedContext = contexts.find(ctx => (ctx.status === APP_STATUS_TSS_GROUP_SELECTED && !!ctx.previousSeed));
    if(!groupSelectedContext) {
      console.log("There is no pending context to reshare it.")
      return;
    }

    keyGenSeed = groupSelectedContext.seed
  }

  console.log('Resharing app tss key ...')
  const tssResponse = await muonCall(configs.url, {
    app: `deployment`,
    method: "tss-reshare",
    params: {
      appId,
      seed: keyGenSeed,
    }
  })
  expectConfirmed(tssResponse)
  console.log(`Reshare tx ${tssResponse.result.reqId}.`)

  console.log(`Reshare confirmation waiting ...`);
  await waitToRequestBeAnnounced(configs.url, tssResponse.result);
  console.log(`TSS key resharing done with this generators: [${tssResponse.result.data.init.keyGenerators}].`, tssResponse.result.data.result)

}
