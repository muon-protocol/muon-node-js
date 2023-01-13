import assert from 'node:assert/strict';
import { muonCall } from '../utils.js'
import {getConfigs} from "./cmd-conf-mod.js";

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
    choices: ['deploy', 'reshare'],
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
  const {action, app} = argv;

  switch (action) {
    case 'deploy': {
      console.log('retrieving app ID ...')
      const statusResult = await muonCall(configs.url, {
        app: 'explorer',
        method: "app",
        params: {
          appName: app,
        }
      })
      const appStatus = statusResult?.result?.status
      const appId = statusResult?.result?.appId
      if (!appStatus) {
        console.log(statusResult);
        throw "Error when retrieving app info";
      }

      console.log('App Id is ', appId);

      if(appStatus === "DEPLOYED")
        throw `App already deployed`;

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
        const deployResponse = await muonCall(configs.url, {
          app: 'deployment',
          method: `deploy`,
          params: {
            appId,
            reqId: randomSeedResponse.result.reqId,
            nonce: randomSeedResponse.result.data.init.nonceAddress,
            seed: randomSeedResponse.result.signatures[0].signature
          }
        })
        expectConfirmed(deployResponse)
        console.log(`deployment done.`)
      }

      console.log('generating app tss key ...')
      const tssResponse = await muonCall(configs.url, {
        app: `deployment`,
        method: "tss-key-gen",
        params: {
          appId,
        }
      })
      expectConfirmed(tssResponse)
      console.log(`tss key generating done.`, tssResponse.result.data.result)
    }
  }
}
