import BaseNetworkPlugin from './base/base-network-plugin.js';
import CollateralInfoPlugin from "./collateral-info.js";
import {fromString as uint8ArrayFromString} from 'uint8arrays/from-string'
import {toString as uint8ArrayToString} from 'uint8arrays/to-string';
import * as CoreIpc from '../../core/ipc.js'
import Log from '../../common/muon-log.js'
import {peerId2Str} from "../utils.js";

const log = Log('muon:network:plugins:broadcast')

export default class NetworkBroadcastPlugin extends BaseNetworkPlugin {

  private handlerRegistered: {[index: string]: boolean} = {}

  async onStart() {
    await super.onStart()

    this.network.libp2p.pubsub.addEventListener("message", this.__onBroadcastReceived.bind(this))
  }

  async subscribe(channel){
    if (channel) {
      log('Subscribing to broadcast channel %s', channel)

      if(!this.handlerRegistered[channel]) {
        this.handlerRegistered[channel] = true;
        await this.network.libp2p.pubsub.subscribe(channel)
      }
    }
  }

  rawBroadcast(channel, data){
    if (!channel) {
      log(`NetworkBroadcastPlugin.rawBroadcast: Channel not defined for broadcast`);
      return;
    }
    let dataStr = JSON.stringify(data)
    this.network.libp2p.pubsub.publish(channel, uint8ArrayFromString(dataStr))
  }

  // async __onBroadcastReceived({data: rawData, from, topicIDs, ...otherItems}){
  async __onBroadcastReceived(evt){
    const {detail: {data: rawData, from: peerId, topic, ...otherItems}} = evt;
    log("broadcast received %o", {sender: peerId2Str(peerId), topic})
    if(!this.handlerRegistered[topic]) {
      // log(`unknown broadcast topic: ${topic}`)
      return;
    }
    let from = peerId2Str(peerId);
    try{
      let strData = uint8ArrayToString(rawData)
      let data = JSON.parse(strData);
      let collateralPlugin: CollateralInfoPlugin = this.network.getPlugin('collateral');

      let senderInfo = collateralPlugin.getNodeInfo(from);
      if(!senderInfo){
        throw {message: `Unrecognized broadcast owner ${from}`, data: strData}
      }

      /** call network process listeners */
      // @ts-ignore
      this.emit(topic, data, senderInfo).catch(e => {
        log('Error when calling listener on topic %s %o', topic, e)
      })
      .then(()=>{});

      /** call core process listeners */
      CoreIpc.broadcast({data: {channel: topic, message: data}, callerInfo: senderInfo})
        .catch(e => {
          log('NetworkBroadcastPlugin.__onBroadcastReceived #1 %O', e)
        })
    }
    catch (e) {
      // console.log(`broadcast message: topic: ${topic}`, uint8ArrayToString(rawData))
      log('NetworkBroadcastPlugin.__onBroadcastReceived #2 %O', e)
    }
  }
}
