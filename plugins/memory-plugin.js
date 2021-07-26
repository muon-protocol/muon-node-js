const BasePlugin = require('./base/base-plugin')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
const crypto = require('../utils/crypto')
const {getTimestamp} = require('../utils/helpers')
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
        else{
          console.log('memWrite signature mismatch', data.memWrite)
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  checkSignature(memWrite){
    let {signatures} = memWrite;
    let hash = this.hashMemWrite(memWrite)
    if(hash !== memWrite.hash) {
      console.log('hash mismatch', [hash, memWrite.hash])
      return false
    }
    let allowedList = this.muon.getNodesWalletList();
    let sigOwners = signatures.map(sig => crypto.recover(hash, sig));
    console.log({
      sigOwners,
      allowedList,
    })
    for(const address of sigOwners){
      if(allowedList.indexOf(addr => (addr.toLowerCase()===address.toLowerCase())) < 0) {
        return false
      }
    }
    return true;
  }

  hashMemWrite(memWrite) {
    let {type, owner, timestamp, ttl, nSign, data} = memWrite;
    let ownerIsWallet = type === Memory.types.Node;
    return crypto.soliditySha3([
      {type: 'string', value: type},
      {type: ownerIsWallet ? 'address' : 'string', value: owner},
      {type: 'uint256', value: timestamp},
      {type: 'uint256', value: ttl},
      {type: 'uint256', value: nSign},
      ... data.map(({type, value}) => ({type, value})),
    ])
  }

  async writeAppMem(request) {
    if(!request.data.memWrite)
      return;

    let {timestamp, ttl, nSign, data, hash} = request.data.memWrite;
    let signatures = request.signatures.map(sign => sign.memWriteSignature)
    let memWrite = {
      type: Memory.types.App,
      owner: request.app,
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

  async writeNodeMem(memory) {
    let {ttl, data} = memory;
    let nSign=1,
      timestamp=getTimestamp();

    let memWrite = {
      type: Memory.types.Node,
      owner: process.env.SIGN_WALLET_ADDRESS,
      timestamp,
      ttl,
      nSign,
      data,
    }
    let hash = this.hashMemWrite(memWrite)
    let signatures = [crypto.sign(hash)]

    memWrite = {
      ...memWrite,
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

  async readAppMem(app, query, options={}) {
    let {
      multi=false,
      distinct=null,
    } = options;

    if(!!distinct){
      return Memory.distinct(distinct, {...query, type: Memory.types.App, owner: app})
    }
    else{
      if(multi){
        return Memory.find({...query, type: Memory.types.App, owner: app})
      }
      else{
        return Memory.findOne({...query, type: Memory.types.App, owner: app})
      }
    }
  }

  async readNodeMem(query, options={}) {
    let {
      multi=false,
      distinct=null,
    } = options

    if(!!distinct) {
      return Memory.distinct(distinct, query)
    }
    else{
      if(multi) {
        return Memory.find({...query, type: Memory.types.Node})
      }
      else {
        return Memory.findOne({...query, type: Memory.types.Node})
      }
    }
  }
}

module.exports = MemoryPlugin;
