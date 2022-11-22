import BaseNetworkPlugin from './base/base-network-plugin';
import CollateralInfoPlugin from "./collateral-info";
const uint8ArrayFromString = require('uint8arrays/from-string').fromString;
const uint8ArrayToString = require('uint8arrays/to-string').toString;
import * as CoreIpc from '../../core/ipc'
const log = require('debug')('muon:network:plugins:broadcast')

export default class NetworkBroadcastPlugin extends BaseNetworkPlugin {

  private handlerRegistered: {[index: string]: boolean} = {}

  async subscribe(channel){
    if (channel) {
      log('Subscribing to broadcast channel %s', channel)

      if(!this.handlerRegistered[channel]) {
        this.handlerRegistered[channel] = true;
        await this.network.libp2p.pubsub.subscribe(channel)
        this.network.libp2p.pubsub.on(channel, this.__onBroadcastReceived.bind(this))
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

  async __onBroadcastReceived({data: rawData, from, topicIDs, ...otherItems}){
    // log("NetworkBroadcastPlugin.__onBroadcastReceived %s %o", from, topicIDs)
    try{
      let strData = uint8ArrayToString(rawData)
      let data = JSON.parse(strData);
      let collateralPlugin: CollateralInfoPlugin = this.network.getPlugin('collateral');

      let senderInfo = collateralPlugin.getNodeInfo(from);
      if(!senderInfo){
        throw {message: `Unrecognized broadcast owner ${from}`, data: strData}
      }

      /** call network process listeners */
      Promise.all(topicIDs.map(topicID => {
        return this.emit(topicID, data, senderInfo).catch(e => {
          log('Error when calling listener on topic %s %o', topicID, e)
        })
      }))
        .then(()=>{});

      /** call core process listeners */
      Promise.all(topicIDs.map(topicID => {
        return CoreIpc.broadcast({data: {channel: topicID, message: data}, callerInfo: senderInfo})
      }))
        .catch(e => {
          log('NetworkBroadcastPlugin.__onBroadcastReceived #1 %O', e)
        })
    }
    catch (e) {
      log('NetworkBroadcastPlugin.__onBroadcastReceived #2 %O', e)
    }
  }
}
