const BasePlugin = require('./base/base-plugin')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
const crypto = require('../utils/crypto')
const Memory = require('../gateway/models/Memory')

class MemoryPlugin extends BasePlugin {

  async onStart() {
    // this.muon.getPlugin('remote-call').on('remote:ping', this.ping)

    let broadcastChannel = this.getBroadcastChannel()
    await this.muon.libp2p.pubsub.subscribe(broadcastChannel)
    this.muon.libp2p.pubsub.on(broadcastChannel, this.__onBroadcastReceived.bind(this))
  }

  getBroadcastChannel() {
    return `muon/memory/write/broadcast`;
  }

  broadcastWrite(memWrite) {
    let broadcastChannel = this.getBroadcastChannel()
    if (!broadcastChannel)
      return;
    let data = {
      type: 'mem_write',
      peerId: process.env.PEER_ID,
      memWrite
    }
    let dataStr = JSON.stringify(data)
    this.muon.libp2p.pubsub.publish(broadcastChannel, uint8ArrayFromString(dataStr))
  }

  async __onBroadcastReceived(msg) {
    try {
      let data = JSON.parse(uint8ArrayToString(msg.data));
      if (data && data.type === 'mem_write' && !!data.memWrite) {
        if(this.checkSignature(data.memWrite)){
          this.storeMemWrite(data.memWrite);
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  checkSignature(memWrite){
    let {app, timestamp, ttl, nSign, data, signatures} = memWrite;
    let hash = crypto.soliditySha3([
      {type: 'string', value: app},
      {type: 'uint256', value: timestamp},
      {type: 'uint256', value: ttl},
      {type: 'uint256', value: nSign},
      ... data.map(({type, value}) => ({type, value})),
    ])
    if(hash !== memWrite.hash)
      return false
    // let sigOwners = signatures.map(sig => crypto.recover(hash, sig));
    return true;
  }

  async writeRequestMem(request) {
    if(!request.data.memWrite)
      return;

    let {timestamp, ttl, nSign, data, hash} = request.data.memWrite;
    let signatures = request.signatures.map(sign => sign.memWriteSignature)
    let memWrite = {
      app: request.app,
      timestamp,
      ttl,
      nSign,
      data,
      hash,
      signatures,
    }
    this.storeMemWrite(memWrite);
    this.broadcastWrite(memWrite);
  }

  storeMemWrite(memWrite){
    let {timestamp, ttl} = memWrite;
    let expireAt = null;
    if(!!timestamp && !!ttl){
      expireAt = (timestamp + ttl) * 1000;
    }
    let mem = new Memory({
      ...memWrite,
      expireAt,
    })
    mem.save();
  }

  async readAppMem(app, query) {
    return Memory.findOne({...query, app})
  }

  async readAppMemMulti(app, query) {
    return Memory.find({...query, app})
  }
}

module.exports = MemoryPlugin;
