import CallablePlugin from './callable-plugin'
import { createClient, RedisClient } from 'redis'
const Request = require('../../../common/db-models/Request')
const AppContext = require("../../../common/db-models/AppContext")
const AppTssConfig = require("../../../common/db-models/AppTssConfig")
const {makeAppDependency} = require('./app-dependencies')
const { getTimestamp, timeout } = require('../../../utils/helpers')
const crypto = require('../../../utils/crypto')
const soliditySha3 = require('../../../utils/soliditySha3')
const tss = require('../../../utils/tss');
const {utils: {toBN}} = require('web3')
const { omit } = require('lodash')
import AppRequestManager from './app-request-manager'
import {remoteApp, remoteMethod, gatewayMethod, broadcastHandler} from './app-decorators'
import MemoryPlugin, {MemWrite, MemWriteOptions} from '../memory-plugin'
const { isArrowFn, deepFreeze } = require('../../../utils/helpers')
const Web3 = require('web3')
import DistributedKey from "../../../utils/tss/distributed-key";
import TssPlugin from "../tss-plugin";
import AppManager from "../app-manager";
import TssParty from "../../../utils/tss/party";
import CollateralInfoPlugin from "../collateral-info";
import {MuonNodeInfo} from "../../../common/types";
import useDistributedKey from "../../../utils/tss/use-distributed-key";
const chalk = require('chalk')
const Ajv = require("ajv")
const ajv = new Ajv()
const web3 = new Web3();
const clone = (obj) => JSON.parse(JSON.stringify(obj))
const Log = require('../../../common/muon-log')

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

const RemoteMethods = {
  WantSign: 'wantSign',
  InformRequestConfirmation: 'InformReqConfirmation',
  AppDeploy: "appDeploy",
  AppTssKeyGenStep1: "AppTssKeyGenStep1",
  AppTssKeyGenStep2: "AppTssKeyGenStep2",
}

@remoteApp
class BaseAppPlugin extends CallablePlugin {
  APP_NAME: string | null = null
  REMOTE_CALL_TIMEOUT = 15000
  requestManager = new AppRequestManager();
  readOnlyMethods = []
  /** initialize when loading */
  isBuiltInApp: boolean
  private log;

  private broadcastPubSubRedis: RedisClient

  constructor(muon, configs) {
    super(muon, configs);

    if(!!process.env.BROADCAST_PUB_SUB_REDIS){
      this.broadcastPubSubRedis = createClient({
        url: process.env.BROADCAST_PUB_SUB_REDIS
      });
    }

    this.log = Log("muon:apps:base")

    // console.log(this.APP_NAME);
    /**
     * This is abstract class, so "new BaseAppPlugin()" is not allowed
     */
    // if (new.target === BaseAppPlugin) {
    //   throw new TypeError("Cannot construct abstract BaseAppPlugin instances directly");
    // }
  }

  @broadcastHandler
  async onBroadcastReceived(data) {
    try {
      if (data && data.type === 'request_signed' &&
        !!process.env.BROADCAST_PUB_SUB_REDIS) {
        // console.log("Publishing request_signed");
        this.broadcastPubSubRedis.publish(
          process.env.BROADCAST_PUB_SUB_CHANNEL,
          JSON.stringify(data)
        );
      }
    } catch (e) {
      console.error(e)
    }
  }

  isV3(){
    return !!this.signParams;
  }

  warnArrowFunctions(methods: Array<string> = []) {
    methods.forEach(method => {
      if(isArrowFn(this[method])){
        console.log(chalk.red(`WARNING !!!: ${method} of '${this.APP_NAME}' app defined as arrow function. Don't use arrow function as an app method.`))
      }
    })
  }

  async onInit() {
    this.log = Log(`muon:apps:${this.APP_NAME}`);

    this.warnArrowFunctions([
      "onArrive",
      "onAppInit",
      "validateRequest",
      "onRequest",
      "hashRequestResult",
      "signParams",
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

    /** load app party on start */
    await this.appManager.waitToLoad();
    await this.collateralPlugin.waitToLoad();

    const appParty = this.tssPlugin.getAppParty(this.APP_ID);
    if(appParty) {
      this.log(`App party loaded %s`, appParty.id)
    }
  }

  getNSign () {
    if(!this.tssPlugin.isReady)
      throw {message: 'Tss not initialized'};
    return this.tssPlugin.tssKey!.party!.t;
  }

  get tssWalletAddress(){
    let tssPlugin = this.muon.getPlugin('tss-plugin');
    return tss.pub2addr(tssPlugin.tssKey.publicKey)
  }

  get tssPlugin(): TssPlugin{
    return this.muon.getPlugin('tss-plugin');
  }

  get collateralPlugin(): CollateralInfoPlugin{
    return this.muon.getPlugin('collateral');
  }

  get appManager(): AppManager {
    return this.muon.getPlugin('app-manager');
  }

  async invoke(appName, method, params) {
    this.log(`invoking app ${appName}.${method} params: %o`, params)
    const app = this.muon.getAppByName(appName)
    let result = await app[method](params);
    return result;
  }

  /**
   * Override BasePlugin BROADCAST_CHANNEL
   */
  protected get BROADCAST_CHANNEL() {
    // return this.APP_NAME ? `muon/${this.APP_NAME}/request/broadcast` : null
    return this.APP_NAME ? super.BROADCAST_CHANNEL : null
  }

  private get appParty(): TssParty | null | undefined {
    return this.appTss?.party;
  }

  private get appTss(): DistributedKey | null {
    return this.tssPlugin.getAppTssKey(this.APP_ID)
  }

  /**
   * A request need's (2 * REMOTE_CALL_TIMEOUT + 5000) millisecond to be confirmed.
   * One REMOTE_CALL_TIMEOUT for first node
   * One REMOTE_CALL_TIMEOUT for other nodes (all other nodes proceed parallel).
   * 5000 for networking
   */
  get requestTimeout(): number {
    return this.REMOTE_CALL_TIMEOUT * 2 + 5000;
  }

  @gatewayMethod("request")
  async __onRequestArrived({method, params, nSign, mode, callId: gatewayCallId, gwSign}) {
    this.log(`request arrived %O`, {method, params})
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

    if(this.isBuiltInApp) {
      if (!this.tssPlugin.isReady)
        throw {message: "Tss not initialized"}
    }
    else{
      if(!this.appManager.appIsDeployed(this.APP_ID))
        throw `App not deployed`;
      if(!this.appManager.appHasTssKey(this.APP_ID))
        throw `App tss not initialized`
    }

    if(this.METHOD_PARAMS_SCHEMA){
      if(this.METHOD_PARAMS_SCHEMA[method]){
        if(!ajv.validate(this.APP_METHOD_PARAMS_SCHEMA[method], params)){
          throw ajv.errors.map(e => e.message).join("\n");
        }
      }
    }

    let newRequest = new Request({
      reqId: null,
      app: this.APP_NAME,
      appId: this.APP_ID,
      method: method,
      nSign,
      [this.isV3() ? 'gwAddress' : 'owner']: process.env.SIGN_WALLET_ADDRESS,
      // peerId: process.env.PEER_ID,
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

      let resultHash;

      if(this.isV3()){
        const appSignParams = this.signParams(newRequest, result)
        const resultHashWithoutSecurityParams = this.hashAppSignParams(newRequest, appSignParams, false);
        newRequest.reqId = this.calculateRequestId(newRequest, resultHashWithoutSecurityParams)
        newRequest.data.signParams = this.appendSecurityParams(newRequest, appSignParams)
        resultHash = this.hashAppSignParams(newRequest, appSignParams)
      }
      else {
        resultHash = this.hashRequestResult(newRequest, result)
        newRequest.reqId = this.calculateRequestId(newRequest, resultHash);
      }

      let isDuplicateRequest = false;
      if(this.requestManager.hasRequest(newRequest.reqId)){
        isDuplicateRequest = true;
        newRequest = this.requestManager.getRequest(newRequest.reqId);
      }
      else {
        this.requestManager.addRequest(newRequest, {requestTimeout: this.requestTimeout});

        newRequest.data.init = {
          ... newRequest.data.init,
          ... await this.onFirstNodeRequestSucceed(clone(newRequest))
        };

        let memWrite = this.getMemWrite(newRequest, result)
        if (!!memWrite) {
          newRequest.data.memWrite = memWrite
        }

        // await newRequest.save()

        let sign = await this.makeSignature(newRequest, result, resultHash)
        if (!!memWrite) {
          sign.memWriteSignature = memWrite.signatures[0]
        }
        this.requestManager.addSignature(newRequest.reqId, sign.owner, sign);
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
          '__v',
          '_id'
          // 'data.memWrite'
        ]),
        ...((confirmed && gwSign) ? {gwSignature: crypto.sign(resultHash)} : {}),
        signatures: confirmed ? signatures : []
      }

      if (confirmed && !isDuplicateRequest) {
        if(!!this.onConfirm) {
          await this.informRequestConfirmation(requestData);
        }
        newRequest.save()
        this.muon.getPlugin('memory').writeAppMem(requestData)

        // console.log('broadcast signed request');
        this.broadcast({
          type: 'request_signed',
          peerId: process.env.PEER_ID,
          requestData
        })
      }

      return requestData
    }
  }

  @gatewayMethod("__info")
  async __getAppInfo({method, params}) {
    return {
      name: this.APP_NAME,
      id: this.APP_ID,
      deployed: this.isBuiltInApp ? true : this.appManager.appIsDeployed(this.APP_ID),
      hasTss: this.appManager.appHasTssKey(this.APP_ID)
    }
  }

  @gatewayMethod("__deploy")
  async qwOnAppDeploy({method, params}) {
    let {timestamp, signature} = params

    const nodesToInform = this.collateralPlugin.filterNodes({
      list: this.tssPlugin.tssParty?.partners,
      isOnline: true
    })

    let callResult = await Promise.all(
      nodesToInform.map(n => {
        if(n.wallet === process.env.SIGN_WALLET_ADDRESS) {
          return this.__onAppDeploy({timestamp, signature}, null)
        }
        else {
          return this.remoteCall(
            n.peerId,
            RemoteMethods.AppDeploy,
            {
              timestamp,
              signature,
            }
          )
        }
      })
    )

    if(callResult.filter(r => r === "OK").length < this.collateralPlugin.TssThreshold)
      throw {message: `Deploy failed`, nodesResponses: callResult}

    return {
      done: true,
      partners: this.collateralPlugin.groupInfo?.partners,
    }
  }

  @gatewayMethod("__keygen")
  async gwOnTssKeygen({method, params}) {
    let {timestamp, signature} = params

    const nodesToInform = this.collateralPlugin.filterNodes({
      list: this.tssPlugin.tssParty?.partners,
      isOnline: true
    })
        .filter(n => n.wallet!==process.env.SIGN_WALLET_ADDRESS)
    /**
     * KeyGen Step 1
     * check that key gen is ok or not
     */
    const callResult = [
      /**
       * current node call
       * if current node return successfully, then other nodes will be called.
       */
      await this.__onAppKeyGenStep1({timestamp, signature}, null),
      /**
       * other nodes call
       */
      ... await Promise.all(
        nodesToInform.map(n => {
          return this.remoteCall(
            n.peerId,
            RemoteMethods.AppTssKeyGenStep1,
            {
              timestamp,
              signature,
            }
          )
        })
      )
    ]
    if(callResult.filter(r => r === "OK").length < this.collateralPlugin.TssThreshold)
      throw {message: `KeyGen creation failed`, nodesCheckResult: callResult}

    /**
     * Creating APP party
     */
    const context = this.appManager.getAppContext(this.APP_ID)
    const partyId = this.tssPlugin.getAppPartyId(context.appId, context.version)
    await this.tssPlugin.createParty({
      id: partyId,
      t: this.tssPlugin.TSS_THRESHOLD,
      partners: context.party.partners
    });

    /**
     * Generate a Distributed Key
     */
    const contextHash = AppContext.hash(context);
    const keyId = `app-tss-key-${contextHash}-${signature}`

    const party = this.tssPlugin.getAppParty(this.APP_ID);
    const key = await this.tssPlugin.keyGen(party, {id: keyId})

    /**
     * KeyGen Step 2
     * save tss key data
     */
    const callResult2 = [
      /**
       * current node call
       * if current node return successfully, then other nodes will be called.
       */
      await this.__onAppKeyGenStep2({timestamp, signature}, null),
      /**
       * other nodes call
       */
      ... await Promise.all(
        nodesToInform.map(n => {
          return this.remoteCall(
            n.peerId,
            RemoteMethods.AppTssKeyGenStep2,
            {
              timestamp,
              signature,
            }
          )
        })
      )
    ]

    if(callResult2.filter(r => r==="OK").length < this.collateralPlugin.TssThreshold)
      throw `KeyGen failed on step 2`;

    return {
      done: true,
      publicKey: {
        address: key.address,
        encoded: key.publicKey?.encodeCompressed("hex"),
        x: key.publicKey?.getX().toBuffer('be', 32).toString('hex'),
        yParity: key.publicKey?.getY().isEven() ? 0 : 1
      },
    }
  }

  async informRequestConfirmation(request) {
    // await this.onConfirm(request)
    let nonce: DistributedKey = this.tssPlugin.getSharedKey(request.reqId)!;
    const partners: MuonNodeInfo[] = [
      /** self */
      this.currentNodeInfo!,
      /** all other online partners */
      ...this.collateralPlugin
        .filterNodes({
          list: nonce?.party!.partners,
          isOnline: true
        })
        .filter(n => n.id !== this.currentNodeInfo!.id),
    ]

    const responses: string[] = await Promise.all(partners.map(async node => {
      if(node.wallet === process.env.SIGN_WALLET_ADDRESS) {
        return await this.__onRequestConfirmation(request, node)
      }
      else {
        return this.remoteCall(
          node.peerId,
          RemoteMethods.InformRequestConfirmation,
          request,
          {taskId: `keygen-${nonce.id}`}
        )
          .catch(e => {
            this.log(`informRequestConfirmation error %o`, e)
            return 'error'
          })
      }
    }))
    const successResponses = responses.filter(r => (r === 'OK'))
    if(successResponses.length < this.tssPlugin.TSS_THRESHOLD)
      throw `Error when informing request confirmation.`
  }

  calculateRequestId(request, resultHash) {
    return crypto.soliditySha3([
      {type: "address", value: this.isV3() ? request.gwAddress : request.owner},
      {type: "uint256", value: crypto.soliditySha3(request.data.uid)},
      {type: "uint32", value: request.data.timestamp},
      {type: this.isV3() ? "uint256" : "uint32", value: request.appId},
      {type: "string", value: crypto.soliditySha3(request.method)},
      {type: "uint256", value: resultHash},
    ]);
  }

  async onFirstNodeRequestSucceed(request) {
    let tssPlugin = this.muon.getPlugin(`tss-plugin`)
    if(!tssPlugin.isReady){
      throw {message: 'Tss not initialized'};
    }

    let party = this.appParty;
    if(!party)
      throw {message: 'App party not generated'}

    let nonceParticipantsCount = Math.ceil(party.t * 1.2)
    let nonce = await tssPlugin.keyGen(party, {
      id: request.reqId,
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
      let { key, ttl, data } = appMem

      if(!this.APP_NAME)
        throw {message: `${this.ConstructorName}.getMemWrite: APP_NAME is not defined`}

      let memWrite: MemWrite = {
        type: 'app',
        key,
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

  async writeNodeMem(key, data, ttl=0) {
    const memory: MemoryPlugin = this.muon.getPlugin('memory')
    await memory.writeNodeMem(`app-${this.APP_ID}-${key}`, data, ttl)
  }

  async readNodeMem(key) {
    const memory: MemoryPlugin = this.muon.getPlugin('memory')
    return await memory.readLocalMem(`app-${this.APP_ID}-${key}`);
  }

  async writeLocalMem(key, data, ttl=0, options:MemWriteOptions) {
    const memory: MemoryPlugin = this.muon.getPlugin('memory')
    return await memory.writeLocalMem(`${this.APP_ID}-${key}`, data, ttl, options)
  }

  async readLocalMem(key) {
    const memory: MemoryPlugin = this.muon.getPlugin('memory')
    return await memory.readLocalMem(`${this.APP_ID}-${key}`);
  }

  async isOtherNodesConfirmed(newRequest) {
    let signers = {}

    // let party = this.tssPlugin.getSharedKey(newRequest.reqId)!.party
    let party = this.appParty
    let verifyingPubKey = this.appTss?.publicKey!

    signers = await this.requestManager.onRequestSignFullFilled(newRequest.reqId)

    let owners = Object.keys(signers)
    let allSignatures = owners.map(w => signers[w]);

    let schnorrSigns = allSignatures.map(({signature}) => {
      let [s, e] = signature.split(',').map(toBN)
      return {s, e};
    })

    const ownersIndex = owners.map(wallet => this.collateralPlugin.getNodeInfo(wallet)!.id);
    let aggregatedSign = tss.schnorrAggregateSigs(party!.t, schnorrSigns, ownersIndex)
    let resultHash;
    if(this.isV3()) {
      // security params already appended to newRequest.data.signParams
      resultHash = this.hashAppSignParams(newRequest, newRequest.data.signParams, false)
    }
    else {
      resultHash = this.hashRequestResult(newRequest, newRequest.data.result);
    }

    // TODO: check more combination of signatures. some time one combination not verified bot other combination does.
    let confirmed = tss.schnorrVerify(verifyingPubKey, resultHash, aggregatedSign)
    // TODO: check and detect nodes misbehavior if request not confirmed

    return [
      confirmed,
      confirmed ? [{
        owner: tss.pub2addr(verifyingPubKey),
        ownerPubKey: {
          x: '0x' + verifyingPubKey.getX().toBuffer('be', 32).toString('hex'),
          yParity: verifyingPubKey.getY().mod(toBN(2)).toString(),
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
    // TODO: change hashRequestResult to hashSignParams after V3 enabled completely
    throw {message: "Only compatible on V3"}
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
    let nonce = tssPlugin.getSharedKey(request.reqId)

    const ownerInfo = this.collateralPlugin.getNodeInfo(owner)
    if(!ownerInfo){
      this.log(`invalid signature owner %s`, owner)
      return false
    }
    let Z_i = pubKey;
    let K_i = nonce.getPubKey(ownerInfo!.id);

    let p1 = tss.pointAdd(K_i, Z_i.mul(e.neg())).encode('hex')
    let p2 = tss.curve.g.mul(s).encode('hex');
    return p1 === p2 ? owner : null;
  }

  verify(hash: string, signature: string, nonceAddress: string): boolean {
    let tssKey = this.appTss;
    const signingPubKey = tssKey!.publicKey;
    return tss.schnorrVerifyWithNonceAddress(hash, signature, nonceAddress, signingPubKey);
  }

  broadcastNewRequest(request) {
    let tssPlugin = this.muon.getPlugin('tss-plugin');
    let nonce: DistributedKey = tssPlugin.getSharedKey(request.reqId)
    let party = nonce.party;
    if(!party)
      throw {message: `${this.ConstructorName}.broadcastNewRequest: nonce.party has not value.`}
    let partners: MuonNodeInfo[] = this.collateralPlugin.filterNodes({list: party.partners})
      .filter((op: MuonNodeInfo) => {
        return op.wallet !== process.env.SIGN_WALLET_ADDRESS && nonce.partners.includes(op.id)
      })

    this.requestManager.setPartnerCount(request.reqId, partners.length + 1);

    // TODO: remove async
    partners.map(async ({peerId, wallet}) => {
      return this.remoteCall(peerId, RemoteMethods.WantSign, request, {timeout: this.REMOTE_CALL_TIMEOUT, taskId: `keygen-${nonce.id}`})
        .then(this.__onRemoteSignTheRequest.bind(this))
        .catch(e => {
          // console.log('base-tss-app-plugin: on broadcast request error', e)
          return this.__onRemoteSignTheRequest(null, {
            request: request.reqId,
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

  appendSecurityParams(request, signParams) {
    return [
      { name: "appId", type: 'uint256', value: this.APP_ID },
      { name: "reqId", type: 'uint256', value: request.reqId },
      ...signParams
    ]
  }

  hashAppSignParams(request, signParams, withSecurityParams=true) {
    if(withSecurityParams) {
      signParams = this.appendSecurityParams(request, signParams);
    }
    try {
      return soliditySha3(signParams)
    }
    catch (e) {
      const {message, ...otherProps} = e;
      throw {
        message: `Failed to hash signParams: ${e.message}`,
        ...otherProps,
        signParams
      }
    }
  }

  async makeSignature(request, result, resultHash): Promise<AppRequestSignature> {
    let signTimestamp = getTimestamp()
    // let signature = crypto.sign(resultHash)

    let tssPlugin = this.muon.getPlugin('tss-plugin');
    let {reqId} = request;
    let nonce = tssPlugin.getSharedKey(reqId)

    // let tssKey = this.isBuiltInApp ? tssPlugin.tssKey : tssPlugin.getAppTssKey(this.APP_ID);
    let tssKey = this.appTss!;
    if(!tssKey)
      throw `App TSS key not found`;
    let k_i = nonce.share
    let K = nonce.publicKey;

    await useDistributedKey(K.encodeCompressed('hex'), resultHash)
    // TODO: remove nonce after sign
    let signature = tss.schnorrSign(tssKey.share, k_i, K, resultHash)

    if(!process.env.SIGN_WALLET_ADDRESS){
      throw {message: "process.env.SIGN_WALLET_ADDRESS is not defined"}
    }

    return {
      request: request.reqId,
      // node stake wallet address
      owner: process.env.SIGN_WALLET_ADDRESS,
      // tss shared public key
      pubKey: tssKey.sharePubKey!,
      timestamp: signTimestamp,
      result,
      signature:`0x${signature.s.toString(16)},0x${signature.e.toString(16)}`
    }
  }

  async __onRemoteSignTheRequest(data: {sign: AppRequestSignature} | null, error) {
    // console.log('BaseAppPlugin.__onRemoteSignTheRequest', data)
    if(error){
      let collateralPlugin:CollateralInfoPlugin = this.muon.getPlugin('collateral');
      let {peerId, request: reqId, ...otherParts} = error;
      let request = this.requestManager.getRequest(reqId);
      if(request) {
        const ownerInfo = collateralPlugin.getNodeInfo(peerId);
        if(ownerInfo) {
          // TODO: replace with ownerInfo.id
          this.requestManager.addError(reqId, ownerInfo.wallet, otherParts);
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
          this.requestManager.addSignature(request.reqId, sign.owner, sign)
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

  callPlugin(pluginName, method, ...otherArgs) {
    if(!this.isBuiltInApp)
      throw `Only built-in apps can call plugins.`
    let plugin = this.muon.getPlugin(pluginName);
    if(!plugin.__appApiExports[method])
      throw `Method ${pluginName}.${method} not exported as API method.`
    return plugin[method](...otherArgs)
  }

  async shieldConfirmedRequest(request) {
    const [result, hash] = await this.preProcessRemoteRequest(request);
    return {
      result,
      hash
    }
  }

  async preProcessRemoteRequest(request) {
    const {method, data: {params={}}} = request
    /**
     * Check request timestamp
     */
    if(getTimestamp() - request.data.timestamp > 40) {
      throw "Request timestamp expired to sign."
    }

    /**
     * validate params schema
     */
    if(this.METHOD_PARAMS_SCHEMA){
      if(this.METHOD_PARAMS_SCHEMA[method]){
        if(!ajv.validate(this.APP_METHOD_PARAMS_SCHEMA[method], params)){
          throw ajv.errors.map(e => e.message).join("\n");
        }
      }
    }

    /**
     * validate request
     */
    if(this.validateRequest){
      await this.validateRequest(request)
    }
    /**
     * Check request result to be same.
     */
    let result = await this.onRequest(request)

    let hash1, hash2, reqId;

    if(this.isV3()) {
      const appSignParams = this.signParams(request, result)
      const resultHashWithoutSecurityParams = this.hashAppSignParams(request, appSignParams, false)
      reqId = this.calculateRequestId(request, resultHashWithoutSecurityParams);

      hash1 = this.hashAppSignParams(request, request.data.signParams, false)
      hash2 = this.hashAppSignParams(request, appSignParams)
    }
    else {
      hash1 = await this.hashRequestResult(request, request.data.result)
      hash2 = await this.hashRequestResult(request, result)
      reqId = this.calculateRequestId(request, hash1);
    }
    if (hash1 !== hash2) {
      throw {
        message: `Request result is not the same as the first node's result.`,
        result
      }
    }
    if(request.reqId !== reqId) {
      throw {message: `Request ID mismatch.`, result}
    }

    return [result, hash1]
  }

  async verifyRequestSignature(_request) {
    const request = clone(_request)
    deepFreeze(request);

    const [result, hash] = await this.preProcessRemoteRequest(request);

    request.signatures.forEach(sign => {
      if(!this.verify(hash, sign.signature, request.data.init.nonceAddress)) {
        throw `TSS signature not verified`
      }
    })
  }

  @remoteMethod(RemoteMethods.WantSign)
  async __onRemoteWantSign(request, callerInfo) {
    this.log(`remote node [id:${callerInfo.id}] wants signature %o`, request)
    deepFreeze(request);
    /**
     * Check request owner
     */
    if((this.isV3() ? request.gwAddress : request.owner) !== callerInfo.wallet){
      throw "Only request owner can want signature."
    }

    /**
     * Check to ensure the current node exists in the app party.
     */
    const context = this.appManager.getAppContext(this.APP_ID)
    if(!context)
      throw `Missing app context`
    const currentNodeInfo = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)!
    if(!context.party.partners.includes(currentNodeInfo.id))
      throw `Current node does not exist in the app party`
    if(!this.appTss)
      throw `Missing app tss key`

    const [result, hash] = await this.preProcessRemoteRequest(request);

    let nonce = this.tssPlugin.getSharedKey(request.reqId);
    // wait for nonce broadcast complete
    await nonce!.waitToFulfill()

    let sign = await this.makeSignature(request, result, hash)
    let memWrite = this.getMemWrite(request, result)
    if(memWrite){
      sign.memWriteSignature = memWrite.signatures[0]
    }

    return { sign }
  }

  @remoteMethod(RemoteMethods.InformRequestConfirmation)
  async __onRequestConfirmation(request, callerInfo) {
    if(!this.onConfirm)
      return `onConfirm not defined for this app`;

    deepFreeze(request);
    /**
     * Check request owner
     */
    if((this.isV3() ? request.gwAddress : request.owner) !== callerInfo.wallet){
      throw "Only request owner can inform confirmation."
    }

    const [result, hash] = await this.preProcessRemoteRequest(request);

    request.signatures.forEach(sign => {
      if(!this.verify(hash, sign.signature, request.data.init.nonceAddress)) {
        throw `TSS signature not verified`
      }
    })

    await this.onConfirm(request, result, request.signatures);

    return `OK`;
  }

  @remoteMethod(RemoteMethods.AppDeploy)
  async __onAppDeploy(data:{timestamp: number, signature: string}, callerInfo) {
    // console.log(`BaseAppPlugin.__onAppDeploy`, data)
    const {timestamp, signature} = data
    if(!timestamp)
      throw `timestamp missing`
    if(!signature)
      throw `signature missing`
    if(this.appManager.appIsDeployed(this.APP_ID))
      throw `App already deployed`
    /**
     * Only built-in apps can be deployed using this method.
     * Client's Apps needs random seed to be deployed
     */
    if(!this.appManager.appIsBuiltIn(this.APP_ID))
      throw `Only builtin apps can deploy with this method. use deployment app to deploy your app.`

    const owners = this.owners || []
    let signatureHash = soliditySha3([
      {t: 'uint256', v: this.APP_ID},
      {t: 'string', v: '__deploy'},
      {t: 'uint64', v: timestamp},
    ])
    const signer = web3.eth.accounts.recover(signatureHash, signature)
    let signatureVerified = owners.includes(signer)
    if(!signatureVerified) {
      throw `Signature not verified. only owners can call this method.`
    }

    const partners = this.collateralPlugin.groupInfo?.partners
    const version = 0;
    const deployTime = timestamp * 1000

    await this.appManager.saveAppContext({
      version, // TODO: version definition
      appId: this.APP_ID,
      appName: this.APP_NAME,
      isBuiltIn: true,
      party: {
        t: this.collateralPlugin.networkInfo?.tssThreshold!,
        max: this.collateralPlugin.networkInfo?.maxGroupSize!,
        partners,
      },
      deploymentRequest: {
        signer,
        timestamp,
        signature,
      },
      deployTime
    })

    return "OK"
  }

  private _validateRemoteKeygenRequest(timestamp, signature) {
    if(!timestamp)
      throw `timestamp missing`
    if(!signature)
      throw `signature missing`
    if(!this.appManager.appIsDeployed(this.APP_ID))
      throw `App is not deployed`
    /**
     * Only built-in apps can be deployed using this method.
     * Client's Apps needs random seed to be deployed
     */
    if(!this.appManager.appIsBuiltIn(this.APP_ID))
      throw `Only builtin apps can deploy with this method. use deployment app to deploy your app.`

    if(this.appManager.appHasTssKey(this.APP_ID))
      throw `App already has tss key`;

    let signatureHash = soliditySha3([
      {t: 'uint256', v: this.APP_ID},
      {t: 'string', v: "__keygen"},
      {t: 'uint64', v: timestamp},
    ])

    const signer = web3.eth.accounts.recover(signatureHash, signature);
    const owners = this.owners || [];
    let signatureVerified = owners.includes(signer)
    if(!signatureVerified) {
      throw `Signature not verified. only owners can call this method.`
    }
  }

  @remoteMethod(RemoteMethods.AppTssKeyGenStep1)
  async __onAppKeyGenStep1(data: {timestamp: number, signature: string}, callerInfo) {
    // console.log(`BaseAppPlugin.__onAppKeyGenStep1`, data);
    let {timestamp, signature} = data
    this._validateRemoteKeygenRequest(timestamp, signature);

    return "OK";
  }

  @remoteMethod(RemoteMethods.AppTssKeyGenStep2)
  async __onAppKeyGenStep2(data: {timestamp: number, signature: string}, callerInfo) {
    // console.log(`BaseAppPlugin.__onAppKeyGenStep2`, data);
    let {timestamp, signature} = data
    this._validateRemoteKeygenRequest(timestamp, signature);

    let context = this.appManager.getAppContext(this.APP_ID)
    const contextHash = AppContext.hash(context);
    const keyId = `app-tss-key-${contextHash}-${signature}`

    const key = this.tssPlugin.getSharedKey(keyId);
    if(!key)
      throw `DistributedKey not generated.`
    await key.waitToFulfill();

    await this.appManager.saveAppTssConfig({
      version: context.version,
      appId: this.APP_ID,
      publicKey: {
        address: key.address,
        encoded: '0x' + key.publicKey?.encodeCompressed('hex'),
        x: '0x' + key.publicKey?.getX().toBuffer('be',32).toString('hex'),
        yParity: key.publicKey?.getY().isEven() ? 0 : 1,
      },
      keyShare: key.share?.toBuffer('be', 32).toString('hex'),
    })

    return "OK"
  }
}

export default BaseAppPlugin;
