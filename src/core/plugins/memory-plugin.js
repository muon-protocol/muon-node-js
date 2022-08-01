/**
 * This plugin provides some API for store and retrieving data in a shared memory on the Muon network.
 * Writing Data is distributed and will write on the all nodes local database. Reading data is locally
 * at the moment.
 *
 * There is Two type of Data can be store in shared memory.
 *
 * 1) node: The owner of this type of MemoryWrite is the `calling node`. The collateral wallet of
 *          the Node will store in memory.  any other nodes can query for this data. This type of
 *          memory write can be done immediately by calling because it needs only the calling nodes
 *          signature.
 *
 * 2) app: The owner of this MemoryWrite is user Apps. The ID of the calling App will store in memory
 *          as the owner of Memory data. This type of MemoryWrite can be stored in memory after that
 *          all nodes (nodes that process the app request) sign the memory write. In the other word, Threshold Signature
 *          needed for this MemoryWrite. Because of the threshold signature, this MemoryWrite only can
 *          be stored when the request is processed successfully.
 *
 * Any node on the network can query for any type of data.
 */

const CallablePlugin = require('./base/callable-plugin')
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

  /**
   * Method for saving APPs data in memory. This method can be called after all nodes
   * process the request. all nodes signature is needed to this data be saved.
   * @param request
   * @returns {Promise<void>}
   */
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

  /**
   * Any node can call this to save a data into the shared memory.
   * only the node signature needed to this data be saved.
   * @param memory
   * @returns {Promise<void>}
   */
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

module.exports = MemoryPlugin;
