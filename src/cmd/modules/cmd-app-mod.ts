import { QueueProducer } from '../../common/message-bus'
let requestQueue = new QueueProducer(`gateway-requests`);
import { muonCall } from '../utils'
const soliditySha3 = require('../../utils/soliditySha3')
import Web3 from 'web3'
import {getConfigs} from "./cmd-conf-mod";
const web3 = new Web3();

module.exports = {
  command: 'app <app> <action> <wallet>',
  describe: 'Deploy/generate/re-share app tss',
  builder: {
    action: {
      describe: "action",
      choices: ['deploy', 'keygen', 'reshare'],
      type: 'string',
    },
    app: {
      describe: "App name to do action on it.",
      type: "string"
    },
    wallet: {
      describe: 'App owner wallet private key',
      demandOption: true,
      type: 'string',
    },
  },

  // Function for your command
  async handler(argv) {
    const configs = getConfigs();
    if(!configs.url)
      throw `Please set muon api url config`;
    const {action, app, wallet} = argv;
    const appInfo = await muonCall(configs.url, {app, method: `__info`,})
    if(!appInfo.success) {
      console.log(appInfo);
      throw appInfo?.error?.message || `Unknown error happened when getting app info.`
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const method = `__${action}`;

    const requestHash = soliditySha3([
      {t: 'uint256', v: appInfo.result.id},
      {t: 'string', v: method},
      {t: 'uint64', v: timestamp},
    ])

    let result = await muonCall(configs.url, {
      app,
      method,
      params: {
        timestamp,
        signature: web3.eth.accounts.sign(requestHash, wallet).signature,
      }
    })
    console.log(JSON.stringify(result, null, 2));
  }
}
