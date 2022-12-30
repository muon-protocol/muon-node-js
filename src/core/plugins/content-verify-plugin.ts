import BasePlugin from './base/base-plugin.js'
import {createCIDFromString, cid2str} from '../../utils/cid.js'
import Violation from '../../common/db-models/Violation.js'
import { subscribeLogEvent } from '../../utils/eth.js'
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const muonAbi = require('../../utils/muon-abi')

const unique = (value, index, self) => {
  return self.indexOf(value) === index
}

export default class ContentVerifyPlugin extends BasePlugin {
  subscribes: Array<()=>void>;
  async onStart() {
    let subscribes = []

    // let chainsContract = this.getChainsContract();
    // for (const [network, address] of Object.entries(chainsContract)) {
    //   let subs = subscribeLogEvent(network, address, muonAbi, 'Transaction', 15000)
    //   subs.on('event', this.onEvent.bind(this));
    //   subscribes.push(subs)
    // }

    this.subscribes = subscribes
  }

  async onEvent(events, network, contractAddress) {
    let contentPlugin = this.muon.getPlugin('content')
    let ethPlugin = this.muon.getPlugin('eth')
    let blocks = events.map(({ blockNumber }) => blockNumber).filter(unique)
    console.log(
      `${network}: num events: ${events.length} blocks: ${JSON.stringify(
        blocks
      )}`
    )
    for (let i in events) {
      let {
        returnValues: { reqId }
      } = events[i]
      // let cid = `f${reqId.substr(2)}`;
      let cid = `f017012202b5a1bf40d6871836d06e2a7d4682105e414ee10e1794770f3defca5e4e49718`
      try {
        let content = await contentPlugin.getContent(cid)
        if (!!content) {
          let description,
            verified = false,
            expectedResult,
            actualResult
          ;[verified, description, expectedResult, actualResult] =
            await this.verifyContent(content, cid)

          // console.log({verified})
          if (!verified) {
            let v = new Violation({
              cid,
              description,
              content,
              expectedResult,
              actualResult
            })
            await v.save()
          }
        } else {
          // TODO: what to do?
        }
        // console.log(JSON.stringify(content, null, 2));
      } catch (e) {
        console.error(e)
      }
    }
  }

  async verifyContent(content, cid) {
    let request,
      description,
      verified = false,
      expectedResult,
      actualResult
    let actualCid = cid2str(await createCIDFromString(content))
    if (cid.toLowerCase() === actualCid.toLowerCase()) {
      request = JSON.parse(content)
      let app = this.muon.getAppByName(request.app)
      if (app) {
        if (app.isVerifiedRequest !== undefined) {
          [verified, expectedResult, actualResult] = await app.isVerifiedRequest(request)
        } else {
          description = `app.isVerifiedRequest not implemented for [${request.app}]`
        }
      } else {
        description = 'unknown app'
      }
    } else {
      console.log({
        cid,
        actualCid
      })
      description = 'cid mismatch'
    }
    return [verified, description, expectedResult, actualResult]
  }

  getChainsContract() {
    const prefix = 'watch_muon_on_'
    return Object.keys(process.env)
      .filter((key) => key.startsWith(prefix))
      .reduce((obj, key) => {
        let chainName = key.substr(prefix.length)
        return { ...obj, [chainName]: process.env[key] }
      }, {})
  }
}
