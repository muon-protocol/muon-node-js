import CallablePlugin from './callable-plugin'
const Request = require('../../../gateway/models/Request')
const {makeAppDependency} = require('./app-dependencies')
const { getTimestamp, timeout } = require('../../../utils/helpers')
const crypto = require('../../../utils/crypto')
const tss = require('../../../utils/tss');
const {utils: {toBN}} = require('web3')
const { omit } = require('lodash')
import AppRequestManager from './app-request-manager'
import {remoteApp, remoteMethod, gatewayMethod} from './app-decorators'
import { MemWrite } from '../memory-plugin'
const { isArrowFn } = require('../../../utils/helpers')
import DistributedKey from "../tss-plugin/distributed-key";
import {OnlinePeerInfo} from "../../../networking/types";
const chalk = require('chalk')
const Ajv = require("ajv")
const ajv = new Ajv()

const clone = (obj) => JSON.parse(JSON.stringify(obj))

export type AppRequestSignature = {
  /**
   * Request hash
   */
  request: string,
  /**
   * Ethereum address of collateral wallet
   */
  owner: string,
  /**
   * Public key of nodes TSS shared
   */
  pubKey: string,
  /**
   * request timestamp
   */
  timestamp: number,
  /**
   * result of request
   */
  result: any,
  /**
   * Schnorr signature of request, signed by TSS share
   */
  signature: string
  /**
   * Schnorr signature of request memWrite, signed by collateral wallet
   */
  memWriteSignature?: string
}

@remoteApp
class BaseAppPlugin extends CallablePlugin {
  APP_NAME = null
  REMOTE_CALL_TIMEOUT = 15000
  requestManager = new AppRequestManager();
  readOnlyMethods = []

  constructor(muon, configs) {
    super(muon, configs);

    /**
     * This is abstract class, so "new BaseAppPlugin()" is not allowed
     */
    // if (new.target === BaseAppPlugin) {
    //   throw new TypeError("Cannot construct abstract BaseAppPlugin instances directly");
    // }
  }

  warnArrowFunctions(methods: Array<string> = []) {
    methods.forEach(method => {
      if(isArrowFn(this[method])){
        console.log(chalk.red(`WARNING !!!: ${method} of '${this.APP_NAME}' app defined as arrow function. Don't use arrow function as an app method.`))
      }
    })
  }

  async onInit() {
    if(this.APP_NAME) {
      this.muon._apps[this.APP_NAME] = this;
    }

    this.warnArrowFunctions([
      "onArrive",
      "onAppInit",
      "validateRequest",
      "onRequest",
      "hashRequestResult",
      "onMemWrite"
    ])
    this.warnArrowFunctions(this.readOnlyMethods);

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
  protected get BROADCAST_CHANNEL() {
    // return this.APP_NAME ? `muon/${this.APP_NAME}/request/broadcast` : null
    return this.APP_NAME ? super.BROADCAST_CHANNEL : null
  }

  @gatewayMethod("request")
  async __onRequestArrived({method, params, nSign, mode, callId: gatewayCallId, gwSign}) {
    let t0 = Date.now()
    let startedAt = getTimestamp()
    if(!nSign && !process.env.NUM_SIGN_TO_CONFIRM) {
      throw 'nSign and NUM_SIGN_TO_CONFIRM is undefined';
    }
    nSign = !!nSign
      ? parseInt(nSign)
      : parseInt(process.env.NUM_SIGN_TO_CONFIRM || "0");

    if(this.getNSign)
      nSign = this.getNSign()

    if(!this.tssPlugin.isReady)
      throw {message: "Tss not initialized"}

    if(this.METHOD_PARAMS_SCHEMA){
      if(this.METHOD_PARAMS_SCHEMA[method]){
        if(!ajv.validate(this.APP_METHOD_PARAMS_SCHEMA[method], params)){
          throw ajv.errors.map(e => e.message).join("\n");
        }
      }
    }

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
      if(this.validateRequest){
        await this.validateRequest(clone(newRequest))
      }
      let result = await this.onRequest(clone(newRequest))
      newRequest.data.result = result
      return omit(newRequest._doc, ['__v'])
    }
    /** sign mode */
    else{
      if(this.validateRequest){
        await this.validateRequest(clone(newRequest))
      }
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
          sign.memWriteSignature = memWrite.signatures[0]
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
        ...((confirmed && gwSign) ? {gwSignature: crypto.sign(resultHash)} : {}),
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

  getMemWrite(request, result): MemWrite | null {
    if (this.hasOwnProperty('onMemWrite')) {
      let memPlugin = this.muon.getPlugin('memory');
      let timestamp = request.startedAt
      let nSign = request.nSign
      let appMem = this.onMemWrite(request, result)
      if (!appMem)
        return null;
      let { ttl, data } = appMem

      if(!this.APP_NAME)
        throw {message: `${this.ConstructorName}.getMemWrite: APP_NAME is not defined`}

      let memWrite: MemWrite = {
        type: 'app',
        owner: this.APP_NAME,
        timestamp,
        ttl,
        nSign,
        data,
        hash: "",
        signatures: []
      }

      let hash: string = memPlugin.hashMemWrite(memWrite);
      let memWriteSignature: string = crypto.sign(hash)
      return { ...memWrite, hash, signatures: [memWriteSignature] }
    }
    else
      return null;
  }

  async memRead(query, options) {
    return this.muon.getPlugin('memory').readAppMem(this.APP_NAME, query, options)
  }

  async writeNodeMem(data, ttl=0) {
    await this.muon.getPlugin('memory').writeNodeMem({ttl, data})
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
    // TODO: check and detect nodes misbehavior if request not confirmed

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
    let nonce: DistributedKey = tssPlugin.getSharedKey(request.hash)
    let party = nonce.party;
    if(!party)
      throw {message: `${this.ConstructorName}.broadcastNewRequest: nonce.party has not value.`}
    let partners: OnlinePeerInfo[] = Object.values(party.partners)
      .filter((op: OnlinePeerInfo) => {
        return op.wallet !== process.env.SIGN_WALLET_ADDRESS && nonce.partners.includes(op.wallet)
      })

    this.requestManager.setPartnerCount(request.hash, partners.length + 1);

    // TODO: remove async
    partners.map(async ({peerId, wallet}) => {
      return this.remoteCall(peerId, 'wantSign', request, {timeout: this.REMOTE_CALL_TIMEOUT, taskId: `keygen-${nonce.id}`})
        .then(this.__onRemoteSignTheRequest.bind(this))
        .catch(e => {
          // console.log('base-tss-app-plugin: on broadcast request error', e)
          return this.__onRemoteSignTheRequest(null, {
            request: request.hash,
            peerId,
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

  makeSignature(request, result, resultHash): AppRequestSignature {
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

    if(!process.env.SIGN_WALLET_ADDRESS){
      throw {message: "process.env.SIGN_WALLET_ADDRESS is not defined"}
    }

    return {
      request: request.hash,
      // node stake wallet address
      owner: process.env.SIGN_WALLET_ADDRESS,
      // tss shared public key
      pubKey: tssKey.sharePubKey,
      timestamp: signTimestamp,
      result,
      signature:`0x${signature.s.toString(16)},0x${signature.e.toString(16)}`
    }
  }

  async __onRemoteSignTheRequest(data: {sign: AppRequestSignature} | null, error) {
    // console.log('BaseAppPlugin.__onRemoteSignTheRequest', data)
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
      let {sign} = data!;
      // let request = await Request.findOne({_id: sign.request})
      let request = this.requestManager.getRequest(sign.request)
      if (request) {
        // TODO: check response similarity
        // let signer = this.recoverSignature(request, sign)
        // if (signer && signer === sign.owner) {
          this.requestManager.addSignature(request.hash, sign.owner, sign)
          // // let newSignature = new Signature(sign)
          // // await newSignature.save()
        // } else {
        //   console.log('signature mismatch', {
        //     request: request.hash,
        //     signer,
        //     sigOwner: sign.owner
        //   })
        // }
      }
      else{
        console.log(`BaseAppPlugin.__onRemoteSignTheRequest >> Request not found id:${sign.request}`)
      }
    }
    catch (e) {
      console.error('BaseAppPlugin.__onRemoteSignTheRequest', e);
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
     * validate request
     */
    if(this.validateRequest){
      await this.validateRequest(clone(request))
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
    if(memWrite){
      sign.memWriteSignature = memWrite.signatures[0]
    }

    return { sign }
  }
}

export default BaseAppPlugin;
