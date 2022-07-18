const CallablePlugin = require('./callable-plugin')
const Request = require('../../../gateway/models/Request')
const {makeAppDependency} = require('./app-dependencies')
const { getTimestamp, timeout } = require('../../../utils/helpers')
const crypto = require('../../../utils/crypto')
const tss = require('../../../utils/tss');
const {utils: {toBN}} = require('web3')
const { omit } = require('lodash')
const AppRequestManager = require('./app-request-manager');
const {remoteApp, remoteMethod, gatewayMethod} = require('../base/app-decorators')

const clone = (obj) => JSON.parse(JSON.stringify(obj))

@remoteApp
class BaseAppPlugin extends CallablePlugin {
  APP_NAME = null
  REMOTE_CALL_TIMEOUT = 15000
  requestManager = new AppRequestManager();
  readOnlyMethods = []

  constructor(...args) {
    super(...args)

    /**
     * This is abstract class, so "new BaseAppPlugin()" is not allowed
     */
    // if (new.target === BaseAppPlugin) {
    //   throw new TypeError("Cannot construct abstract BaseAppPlugin instances directly");
    // }

  }

  async onInit() {
    this.muon._apps[this.APP_NAME] = this;

    if(this.dependencies){
      this.initializeDependencies();
    }
    if(this.onAppInit)
      this.onAppInit();
  }

  initializeDependencies() {
    this.dependencies.map(key => {
      this[key] = makeAppDependency(this, key);
    })
  }

  async onStart() {
    super.onStart();
    // console.log(`onStart app[${this.APP_NAME}] ...`, this.constructor)

    /**
     * register apps readonly methods
     */
    if(this.readOnlyMethods.length > 0){
      let gateway = this.muon.getPlugin('gateway-interface')
      this.readOnlyMethods.forEach(method => {
        gateway.registerAppCall(this.APP_NAME, method, this[method].bind(this))
      })
    }
  }

  getNSign () {
    if(!this.tssPlugin.isReady)
      throw {message: 'Tss not initialized'};
    return this.tssPlugin.tssKey.party.t;
  }

  get tssWalletAddress(){
    let tssPlugin = this.muon.getPlugin('tss-plugin');
    return tss.pub2addr(tssPlugin.tssKey.publicKey)
  }

  get tssPlugin(){
    return this.muon.getPlugin('tss-plugin');
  }

  async invoke(appName, method, params) {
    let result = await this.muon._apps[appName][method](params);
    return result;
  }

  /**
   * Override BasePlugin BROADCAST_CHANNEL
   */
  get BROADCAST_CHANNEL() {
    // return this.APP_NAME ? `muon/${this.APP_NAME}/request/broadcast` : null
    return this.APP_NAME ? super.BROADCAST_CHANNEL : null
  }

  @gatewayMethod("request")
  async __onRequestArrived(method, params, nSign, mode, gatewayCallId) {
    let t0 = Date.now()
    let startedAt = getTimestamp()
    nSign = !!nSign
      ? parseInt(nSign)
      : parseInt(process.env.NUM_SIGN_TO_CONFIRM)

    if(this.getNSign)
      nSign = this.getNSign(nSign)

    let newRequest = new Request({
      hash: null,
      app: this.APP_NAME,
      appId: this.APP_ID,
      method: method,
      nSign,
      owner: process.env.SIGN_WALLET_ADDRESS,
      peerId: process.env.PEER_ID,
      data: {
        uid: gatewayCallId,
        params,
        timestamp: startedAt,
      },
      startedAt
    })
    let t1= Date.now()

    /** view mode */
    if(mode === "view"){
      let result = await this.onRequest(clone(newRequest))
      newRequest.data.result = result
      return omit(newRequest._doc, ['__v'])
    }
    /** sign mode */
    else{
      if(this.onArrive){
        newRequest.data.init = await this.onArrive(clone(newRequest))
      }
      let t2 = Date.now()

      let result = await this.onRequest(clone(newRequest))
      newRequest.data.result = result
      let t3 = Date.now()

      let resultHash = this.hashRequestResult(newRequest, result)
      newRequest.hash = this.calculateRequestHash(newRequest, resultHash);

      let isDuplicateRequest = false;
      if(this.requestManager.hasRequest(newRequest.hash)){
        isDuplicateRequest = true;
        newRequest = this.requestManager.getRequest(newRequest.hash);
      }
      else {
        /**
         * A request need's (2 * REMOTE_CALL_TIMEOUT + 5000) millisecond to be confirmed.
         * One REMOTE_CALL_TIMEOUT for first node
         * One REMOTE_CALL_TIMEOUT for other nodes (all other nodes proceed parallel).
         * 5000 for networking
         */
        this.requestManager.addRequest(newRequest, {requestTimeout: this.REMOTE_CALL_TIMEOUT * 2 + 5000});

        newRequest.data.init = {
          ... newRequest.data.init,
          ... await this.onFirstNodeRequestSucceed(clone(newRequest))
        };

        let memWrite = this.getMemWrite(newRequest, result)
        if (!!memWrite) {
          newRequest.data.memWrite = memWrite
        }

        // await newRequest.save()

        let sign = this.makeSignature(newRequest, result, resultHash)
        if (!!memWrite) {
          sign.memWriteSignature = memWrite.signature
        }
        this.requestManager.addSignature(newRequest.hash, sign.owner, sign);
        // new Signature(sign).save()

        this.broadcastNewRequest(newRequest)
        let t4 = Date.now()
      }

      let [confirmed, signatures] = await this.isOtherNodesConfirmed(newRequest)
      let t5 = Date.now()

      // console.log('base-app-plugin.__onRequestArrived',{
      //   t1: t1-t0,
      //   t2: t2-t1,
      //   t3: t3-t2,
      //   t4: t4-t3,
      //   t5: t5-t4,
      //   '*': t5-t0
      // })

      if (confirmed) {
        newRequest['confirmedAt'] = getTimestamp()
      }

      let requestData = {
        confirmed,
        ...omit(newRequest._doc, [
          '__v'
          // 'data.memWrite'
        ]),
        signatures: confirmed ? signatures : []
      }

      if (confirmed && !isDuplicateRequest) {
        newRequest.save()
        this.muon.getPlugin('memory').writeAppMem(requestData)
      }

      return requestData
    }
  }

  calculateRequestHash(request, resultHash) {
    return crypto.soliditySha3([
      {type: "address", value: request.owner},
      {type: "uint256", value: crypto.soliditySha3(request.data.uid)},
      {type: "uint32", value: request.data.timestamp},
      {type: "string", value: request.app}, // TODO: APP_ID instead of name
      {type: "string", value: crypto.soliditySha3(request.method)},
      {type: "uint256", value: resultHash},
    ]);
  }

  async onFirstNodeRequestSucceed(request) {
    let tssPlugin = this.muon.getPlugin(`tss-plugin`)
    if(!tssPlugin.isReady){
      throw {message: 'Tss not initialized'};
    }
    let party = tssPlugin.tssKey.party;
    // console.log('party generation done.')
    if(!party)
      throw {message: 'party not generated'}

    let nonceParticipantsCount = Math.ceil(party.t * 1.2)
    let nonce = await tssPlugin.keyGen(party, {
      id: request.hash,
      maxPartners: nonceParticipantsCount
    })

    // let sign = tssPlugin.sign(null, party);
    return {
      // noncePub: nonce.publicKey.encode('hex'),
      nonceAddress: tss.pub2addr(nonce.publicKey),
    }
  }

  getMemWrite(request, result) {
    if (this.hasOwnProperty('onMemWrite')) {
      let memPlugin = this.muon.getPlugin('memory');
      let timestamp = request.startedAt
      let nSign = request.nSign
      let appMem = this.onMemWrite(request, result)
      if (!appMem) return
      let { ttl, data } = appMem

      let memWrite = {
        type: 'app',
        owner: this.APP_NAME,
        timestamp,
        ttl,
        nSign,
        data,
      }

      let hash = memPlugin.hashMemWrite(memWrite);
      let signature = crypto.sign(hash)
      return { ...memWrite, hash, signature }
    }
  }

  async memRead(query, options) {
    return this.muon.getPlugin('memory').readAppMem(this.APP_NAME, query, options)
  }

  async writeNodeMem(data, ttl=0) {
    this.muon.getPlugin('memory').writeNodeMem({ttl, data})
  }

  async readNodeMem(query, options) {
    return this.muon.getPlugin('memory').readNodeMem(query, options)
  }

  async isOtherNodesConfirmed(newRequest) {
    let signers = {}

    let party = this.tssPlugin.getSharedKey(newRequest.hash).party
    let masterWalletPubKey = this.muon.getSharedWalletPubKey()
    let signersIndices;

    signers = await this.requestManager.onRequestSignFullFilled(newRequest.hash)

    let owners = Object.keys(signers)
    let allSignatures = owners.map(w => signers[w]);

    let schnorrSigns = allSignatures.map(({signature}) => {
      let [s, e] = signature.split(',').map(toBN)
      return {s, e};
    })
    let aggregatedSign = tss.schnorrAggregateSigs(party.t, schnorrSigns, owners)
    let resultHash = this.hashRequestResult(newRequest, newRequest.data.result);

    // TODO: check more combination of signatures. some time one combination not verified bot other combination does.
    let confirmed = tss.schnorrVerify(masterWalletPubKey, resultHash, aggregatedSign)

    return [
      confirmed,
      confirmed ? [{
        owner: tss.pub2addr(masterWalletPubKey),
        ownerPubKey: {
          x: '0x' + masterWalletPubKey.x.toBuffer('be', 32).toString('hex'),
          yParity: masterWalletPubKey.y.mod(toBN(2)).toString(),
        },
        // signers: signersIndices,
        timestamp: getTimestamp(),
        result: newRequest.data.result,
        // signature: `0x${aggregatedSign.s.toString(16)},0x${aggregatedSign.e.toString(16)}`,
        signature: '0x' + aggregatedSign.s.toBuffer('be', 32).toString('hex'),
        // sign: {
        //   s: `0x${aggregatedSign.s.toString(16)}`,
        //   e: `0x${aggregatedSign.e.toString(16)}`
        // },
        memWriteSignature: allSignatures[0]['memWriteSignature']
      }] : []
    ]
  }

  /**
   *
   * @param request
   * @returns {Promise<*[isVerified, expectedResult, actualResult]>}
   */
  async isVerifiedRequest(request) {
    let actualResult
    try {
      let {
        data: { result }
      } = request
      actualResult = await this.onRequest(clone(request))
      let verified = false
      if (actualResult) {
        let hash1 = this.hashRequestResult(request, result)
        let hash2 = this.hashRequestResult(request, actualResult)
        verified = hash1 === hash2
      }
      return [verified, request.data.result, actualResult]
    } catch (e) {
      return [false, request.data.result, actualResult]
    }
  }

  recoverSignature(request, sign) {
    let tt0 = Date.now();
    let {owner, pubKey: pubKeyStr} = sign;
    let pubKey = tss.keyFromPublic(pubKeyStr);
    // TODO: need to recheck
    // if(owner !== tss.pub2addr(pubKey)) {
    //   console.log({owner, pubKeyStr,})
    //   throw {message: 'Sign recovery error: invalid pubKey address'}
    // }

    let [s, e] = sign.signature.split(',').map(toBN)
    // let sig = {s, e}
    //
    let tssPlugin = this.muon.getPlugin('tss-plugin');
    let nonce = tssPlugin.getSharedKey(request.hash)

    let idx = owner;
    let Z_i = pubKey;
    let K_i = nonce.getPubKey(idx);

    let p1 = tss.pointAdd(K_i, Z_i.mul(e.neg())).encode('hex')
    let p2 = tss.curve.g.mul(s).encode('hex');
    return p1 === p2 ? owner : null;
  }

  broadcastNewRequest(request) {
    let tssPlugin = this.muon.getPlugin('tss-plugin');
    let nonce = tssPlugin.getSharedKey(request.hash)
    let party = nonce.party;

    let partners = Object.values(party.partners)
      .filter(({wallet}) => (wallet !== process.env.SIGN_WALLET_ADDRESS && nonce.partners.includes(wallet)))

    this.requestManager.setPartnerCount(request.hash, partners.length + 1);

    partners.map(async ({peer, wallet}) => {
      return this.remoteCall(peer, 'wantSign', request, {timeout: this.REMOTE_CALL_TIMEOUT, taskId: `keygen-${nonce.id}`})
        .then(this.__onRemoteSignRequest.bind(this))
        .catch(e => {
          // console.log('base-tss-app-plugin: on broadcast request error', e)
          return this.__onRemoteSignRequest(null, {
            request: request.hash,
            peerId: peer.id,
            ...e
          });
        })
    })
  }

  /**
   * hash parameters that smart contract need it.
   *
   * @param request
   * @param result
   * @returns {sha3 hash of parameters}
   */
  hashRequestResult(request, result) {
    return null
  }

  makeSignature(request, result, resultHash) {
    let signTimestamp = getTimestamp()
    // let signature = crypto.sign(resultHash)

    let tssPlugin = this.muon.getPlugin('tss-plugin');
    let {hash: requestHash} = request;
    let nonce = tssPlugin.getSharedKey(requestHash)

    let tssKey = tssPlugin.tssKey;
    let k_i = nonce.share
    let K = nonce.publicKey;
    // TODO: remove nonce after sign
    let signature = tss.schnorrSign(tssKey.share, k_i, K, resultHash)

    return {
      request: request.hash,
      // node stake wallet address
      owner: process.env.SIGN_WALLET_ADDRESS,
      // tss shared public key
      pubKey: tss.keyFromPrivate(tssKey.share).getPublic().encode('hex'),
      timestamp: signTimestamp,
      result,
      signature:`0x${signature.s.toString(16)},0x${signature.e.toString(16)}`
    }
  }

  async __onRemoteSignRequest(data = {}, error) {
    // console.log('BaseAppPlugin.__onRemoteSignRequest', data)
    if(error){
      let collateralPlugin = this.muon.getPlugin('collateral');
      let {peerId, request: reqHash, ...otherParts} = error;
      let request = this.requestManager.getRequest(reqHash);
      if(request) {
        const owner = collateralPlugin.getPeerWallet(peerId);
        if(owner) {
          this.requestManager.addError(reqHash, owner, otherParts);
        }
      }
      return;
    }
    try {
      let {sign, memWrite} = data;
      // let request = await Request.findOne({_id: sign.request})
      let request = this.requestManager.getRequest(sign.request)
      if (request) {
        // TODO: check response similarity
        let signer = this.recoverSignature(request, sign)
        if (signer && signer === sign.owner) {
          if (!!memWrite) {
            // TODO: validate memWright signature
            sign.memWriteSignature = memWrite.signature
          }
          this.requestManager.addSignature(request.hash, sign.owner, sign)
          // let newSignature = new Signature(sign)
          // await newSignature.save()
        } else {
          console.log('signature mismatch', {
            request: request.hash,
            signer,
            sigOwner: sign.owner
          })
        }
      }
      else{
        console.log(`BaseAppPlugin.__onRemoteSignRequest >> Request not found id:${sign.request}`)
      }
    }
    catch (e) {
      console.error('BaseAppPlugin.__onRemoteSignRequest', e);
    }
  }

  @remoteMethod('wantSign')
  async __onRemoteWantSign(request, callerInfo) {
    /**
     * Check request owner
     */
    if(request.owner !== callerInfo.wallet){
      throw "Only request owner can want signature."
    }
    /**
     * Check request timestamp
     */
    if(getTimestamp() - request.data.timestamp > 40) {
      throw "Request timestamp expired to sign."
    }
    /**
     * Check request result to be same.
     */
    let result = await this.onRequest(clone(request))

    let hash1 = await this.hashRequestResult(request, request.data.result)
    let hash2 = await this.hashRequestResult(request, result)

    if (hash1 !== hash2) {
      throw {
        message: `Request result is not the same as the first node's result.`,
        result
      }
    }

    let requestHash = this.calculateRequestHash(request, hash1);
    if(requestHash !== request.hash) {
      throw {
        message: `Request hash mismatch.`,
        result
      }
    }

    let nonce = this.tssPlugin.getSharedKey(request.hash);
    // wait for nonce broadcast complete
    await nonce.waitToFulfill()

    let sign = this.makeSignature(request, result, hash2)
    let memWrite = this.getMemWrite(request, result)

    return { sign, memWrite }
  }
}

module.exports = BaseAppPlugin
