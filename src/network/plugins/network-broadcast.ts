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

  async subscribe(channel){
    if (channel) {
      log('Subscribing to broadcast channel %s', channel)

      if(!this.handlerRegistered[channel]) {
        this.handlerRegistered[channel] = true;
        await this.network.libp2p.pubsub.subscribe(channel)
        // this.network.libp2p.pubsub.on(channel, this.__onBroadcastReceived.bind(this))
        this.network.libp2p.pubsub.addEventListener("message", this.__onBroadcastReceived.bind(this))
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
    console.log("NetworkBroadcastPlugin.__onBroadcastReceived %s %o")
    const {detail: {data: rawData, from: peerId, topic, ...otherItems}} = evt;
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
      log('NetworkBroadcastPlugin.__onBroadcastReceived #2 %O', e)
    }
  }
}
