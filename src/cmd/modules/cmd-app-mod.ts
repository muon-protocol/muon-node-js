import assert from 'node:assert/strict';
import { muonCall } from '../utils'
import {getConfigs} from "./cmd-conf-mod";

function expectConfirmed(response) {
  try {
    assert.equal(response?.success, true, "request not succeeded")
    assert.equal(response?.result?.confirmed, true, "request not confirmed")
  }catch (e) {
    console.dir(response, {depth: null})
    throw e
  }
}

module.exports = {
  command: 'app <action> <app>',
  describe: 'Deploy/re-share app tss',
  builder: {
    action: {
      describe: "action",
      choices: ['deploy', 'reshare'],
      type: 'string',
    },
    app: {
      describe: "App name to do action on it.",
      type: "string"
    }
  },

  // Function for your command
  async handler(argv) {
    const configs = getConfigs();
    if(!configs.url)
      throw `Please set muon api url config`;
    const {action, app} = argv;

    switch (action) {
      case 'deploy': {
        console.log('retrieving app ID ...')
        const idResponse = await muonCall(configs.url, {app, method: `dummy-method`})
        assert('appId' in idResponse, "appId not exist in ID response")
        const { appId } = idResponse
        console.log('App Id is ', appId);

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
}
