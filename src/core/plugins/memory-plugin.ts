import CallablePlugin from './base/callable-plugin'
const uint8ArrayFromString = require('uint8arrays/from-string').fromString;
const uint8ArrayToString = require('uint8arrays/to-string').toString;
const crypto = require('../../utils/crypto')
const {getTimestamp} = require('../../utils/helpers')
const Memory = require('../../gateway/models/Memory')
const { remoteApp, broadcastHandler } = require('./base/app-decorators')

@remoteApp
class MemoryPlugin extends CallablePlugin {

  broadcastWrite(memWrite) {
    this.broadcast({
      type: 'mem_write',
      peerId: process.env.PEER_ID,
      memWrite
    })
  }

  @broadcastHandler
  async onBroadcastReceived(data) {
    try {
      // let data = JSON.parse(uint8ArrayToString(msg.data));
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
    let collateralPlugin = this.muon.getPlugin('collateral');

    let {signatures} = memWrite;
    let hash = this.hashMemWrite(memWrite)
    if(hash !== memWrite.hash) {
      console.log('hash mismatch', [hash, memWrite.hash])
      return false
    }
    let allowedList = collateralPlugin.getWallets();
    let sigOwners = signatures.map(sig => crypto.recover(hash, sig));
    for(const address of sigOwners){
      let index = allowedList.findIndex(addr => (addr.toLowerCase()===address.toLowerCase()))
      if(index < 0) {
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
      hash: '',
      signatures: []
    }
    memWrite.hash = this.hashMemWrite(memWrite)
    // @ts-ignore
    memWrite.signatures = [crypto.sign(memWrite.hash)]

    this.storeMemWrite(memWrite);
    this.broadcastWrite(memWrite);
  }

  storeMemWrite(memWrite){
    let {timestamp, ttl} = memWrite;
    let expireAt = null;
    if(!!timestamp && !!ttl){
      // @ts-ignore
      expireAt = (timestamp + ttl) * 1000;
    }
    let mem = new Memory({
      ...memWrite,
      expireAt,
    })
    mem.save();
  }

  async readAppMem(app, query, options={}) {
    // @ts-ignore
    let {multi=false, distinct=null,} = options;

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
    // @ts-ignore
    let {multi=false, distinct=null,} = options

    if(!!distinct) {
      return Memory.distinct(distinct, query)
    }
    else{
      let expirationCheck = {
        $or: [
          {expireAt: {$eq: null}},
          {expireAt: {$gt: Date.now()}}
        ]
      }

      let {$or: orPart, $and: andPart=[], ...otherParts} = query;

      // query may have "or" element itself.
      let mixedOr = !!orPart ? {
        // query may have "and" element itself.
        $and: [
          ...andPart,
          {$or: orPart},
          expirationCheck
        ]
      } : expirationCheck;

      let finalQuery = {
        ...otherParts,
        type: Memory.types.Node,
        ...mixedOr
      }

      if(multi) {
        return Memory.find(finalQuery)
      }
      else {
        return Memory.findOne(finalQuery)
      }
    }
  }
}

export default MemoryPlugin;
