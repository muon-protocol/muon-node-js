import { QueueProducer } from '../../common/message-bus'
let requestQueue = new QueueProducer(`gateway-requests`);
import { muonCall } from '../utils'
const soliditySha3 = require('../../utils/soliditySha3')
import Web3 from 'web3'
const web3 = new Web3();

module.exports = {
  command: 'tss <action> <app> <wallet> [url]',
  describe: 'Generate or re-share app tss',
  builder: {
    action: {
      describe: "action",
      choices: ['keygen', 'reshare'],
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
    url: {
      describe: "Muon node api url",
      demandOption: true,
      type: "url",
      default: "http://localhost:8000/v1"
    }
  },

  // Function for your command
  async handler(argv) {
    const {action, app, wallet, url} = argv;
    const appInfo = await muonCall(url, {app, method: `__info`,})
    if(!appInfo.success) {
      console.log(appInfo);
      throw appInfo?.error?.message || `Unknown error happened when getting app info.`
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const method = `tss-${action}`;

    const requestHash = soliditySha3([
      {t: 'uint256', v: appInfo.result.id},
      {t: 'string', v: method},
      {t: 'uint64', v: timestamp},
    ])

    let result = await muonCall(url, {
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
