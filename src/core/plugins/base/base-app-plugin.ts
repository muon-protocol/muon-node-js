import CallablePlugin from './callable-plugin.js'
import { createClient, RedisClient } from 'redis'
import Request from '../../../common/db-models/Request.js'
import AppContext from "../../../common/db-models/AppContext.js"
import AppTssConfig from "../../../common/db-models/AppTssConfig.js"
import {makeAppDependency} from './app-dependencies/index.js'
import {getTimestamp, pub2json, timeout} from '../../../utils/helpers.js'
import * as crypto from '../../../utils/crypto.js'
import soliditySha3 from '../../../utils/soliditySha3.js'
import * as tss from '../../../utils/tss/index.js'
import Web3 from 'web3'
import lodash from 'lodash'
import AppRequestManager from './app-request-manager.js'
import {remoteApp, remoteMethod, gatewayMethod, broadcastHandler} from './app-decorators.js'
import MemoryPlugin, {MemWrite, MemWriteOptions} from '../memory-plugin.js'
import { isArrowFn, deepFreeze } from '../../../utils/helpers.js'
import DistributedKey from "../../../utils/tss/distributed-key.js";
import TssPlugin from "../tss-plugin.js";
import AppManager from "../app-manager.js";
import TssParty from "../../../utils/tss/party.js";
import CollateralInfoPlugin from "../collateral-info.js";
import {MuonNodeInfo} from "../../../common/types";
import useDistributedKey from "../../../utils/tss/use-distributed-key.js";
import chalk from 'chalk'
import Ajv from "ajv"
import {logger} from '@libp2p/logger'
import {bn2hex} from "../../../utils/tss/utils.js";
import * as NetworkIpc from "../../../network/ipc.js";
import {PublicKey} from "../../../utils/tss/types";

const { omit } = lodash;
const {utils: {toBN}} = Web3
const ajv = new Ajv()
const web3 = new Web3();
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

const RemoteMethods = {
  WantSign: 'wantSign',
  InformRequestConfirmation: 'InformReqConfirmation',
  GetTssPublicKey: "get-tss-pub",
  HB: "HB",
}

@remoteApp
class BaseAppPlugin extends CallablePlugin {
  /**=================================*/
  APP_ID: string;
  dependencies: string[];
  readOnlyMethods: string[] = [];
  onAppInit: () => void;
  validateRequest: (request: any) => void;
  onArrive: (request: any) => any;
  onRequest: (request: any) => any;
  signParams: (request: object, result: any) => any[];
  onMemWrite: (request: object, result: any) => object;
  getConfirmAnnounceList: (request: object) => Promise<string[]>;
  onConfirm: (request: object, result: any, signatures: any[]) => void;
  METHOD_PARAMS_SCHEMA: object = {};
  /**=================================*/
  APP_NAME: string | null = null
  REMOTE_CALL_TIMEOUT = 60000
  requestManager = new AppRequestManager();
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

    this.log = logger("muon:apps:base")

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
    this.log = logger(`muon:apps:${this.APP_NAME}`);

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
    return this.tssPlugin.getAppParty(this.APP_ID);
  }

  private get appTss(): DistributedKey | null {
    return this.tssPlugin.getAppTssKey(this.APP_ID)
  }

  /** useful when current node is not in the app party */
  private async findTssPublicKey(): Promise<PublicKey | null> {
    /** if key exist in current node */
    let publicKey = this.appTss?.publicKey
    if(publicKey)
      return publicKey

    /** ask deployers for app tss public key */
    const deployersPeerId: string[] = this.collateralPlugin.filterNodes({isDeployer: true}).map(p => p.peerId);
    let onlineDeployers: string[] = await NetworkIpc.findNOnlinePeer(deployersPeerId, 3, {timeout: 5000, return: 'peerId'})
    // @ts-ignore
    const publicKeyStr: string = await Promise.any(onlineDeployers.map(peerId => {
      return this.remoteCall(
        peerId,
        RemoteMethods.GetTssPublicKey,
      )
    }))

    return DistributedKey.loadPubKey(publicKeyStr);
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
  async __onRequestArrived({method, params, mode, callId: gatewayCallId, gwSign}) {
    this.log(`request arrived %O`, {method, params})
    let t0 = Date.now()
    let startedAt = getTimestamp()

    if(this.APP_ID === '1') {
      if (!this.tssPlugin.isReady)
        throw {message: "Tss not initialized"}
    }
    else{
      if(!this.appManager.appIsDeployed(this.APP_ID))
        throw `App not deployed`;
      if(!this.appManager.appHasTssKey(this.APP_ID)) {
        this.tssPlugin.checkAppTssKeyRecovery(this.APP_ID);
        throw `App tss not initialized`
      }
    }

    const nSign = this.appParty!.t;

    if(this.METHOD_PARAMS_SCHEMA){
      if(this.METHOD_PARAMS_SCHEMA[method]){
        if(!ajv.validate(this.METHOD_PARAMS_SCHEMA[method], params)){
          // @ts-ignore
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
      let t0 = Date.now(), t1, t2, t3, t4, t5, t6;;
      let appParty = this.appParty!;
      /** find available partners to sign the request */
      const availablePartners: string[] = await NetworkIpc.findNOnlinePeer(appParty.partners, Math.ceil(appParty.t*1.2))
      t1 = Date.now();
      this.log(`partners:[%o] are available to sign the request`, availablePartners)
      if(availablePartners.length < appParty.t)
        throw `Insufficient partner to sign the request, only ${availablePartners.length} are available`

      if(this.validateRequest){
        await this.validateRequest(clone(newRequest))
      }
      if(this.onArrive){
        newRequest.data.init = await this.onArrive(clone(newRequest))
      }

      let result = await this.onRequest(clone(newRequest))
      this.log(`app result: %O`, result)
      newRequest.data.result = result

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

        t2 = Date.now()
        newRequest.data.init = {
          ... newRequest.data.init,
          ... await this.onFirstNodeRequestSucceed(clone(newRequest), availablePartners)
        };
        t3 = Date.now();

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

        this.log('broadcasting request ...');
        await this.broadcastNewRequest(newRequest)
        t4 = Date.now()
      }

      let [confirmed, signatures] = await this.isOtherNodesConfirmed(newRequest)
      this.log(`confirmation done with %s`, confirmed)
      t5 = Date.now()

      let nonce = await this.tssPlugin.getSharedKey(`nonce-${newRequest.reqId}`, 15000)
      this.log(`request signed with %o`, nonce.partners);
      this.log('request time parts %O',{
        "find online nodes": t1-t0,
        "req exec time": t2-t1,
        "dkg time": t3-t2,
        "req broadcast": t4-t3,
        "confirm waiting": t5-t4,
      })

      if (confirmed) {
        newRequest['confirmedAt'] = getTimestamp()
      }

      let requestData: {[index: string]: any} = {
        confirmed,
        ...omit(newRequest._doc, [
          '__v',
          '_id'
          // 'data.memWrite'
        ]),
        signatures: confirmed ? signatures : []
      }

      // console.log("requestData", requestData)

      if(confirmed && gwSign){
        let cryptoSign = crypto.sign(resultHash);
        requestData.gwSignature = cryptoSign;
        requestData.nodeSignature = cryptoSign;
      }

      if (confirmed && !isDuplicateRequest) {
        if(!!this.onConfirm) {
          await this.informRequestConfirmation(requestData)
            // .catch(e => {
            //   this.log.error("error when informing request confirmation %O", e)
            // })
        }
        newRequest.save()
        this.muon.getPlugin('memory').writeAppMem(requestData)

        console.log('broadcasting signed request');
        // this.broadcast({
        //   type: 'request_signed',
        //   peerId: process.env.PEER_ID,
        //   requestData
        // })
        console.log('broadcasted');
      }

      return requestData
    }
  }

  async informRequestConfirmation(request) {
    // await this.onConfirm(request)
    let nonce: DistributedKey = await this.tssPlugin.getSharedKey(`nonce-${request.reqId}`)!;

    let announceList = [
      process.env.SIGN_WALLET_ADDRESS!,
      ... this.appParty!.partners
    ]
    if(!!this.getConfirmAnnounceList) {
      let moreAnnounceList = await this.getConfirmAnnounceList(request);
      this.log(`custom announce list: %o`, moreAnnounceList)
      if(Array.isArray(moreAnnounceList)) {
        if(moreAnnounceList.findIndex(n => typeof n !== "string") < 0) {
          announceList = [
            ... announceList,
            ... moreAnnounceList
          ]
        }
      }
    }

    const partners: MuonNodeInfo[] = this.collateralPlugin.filterNodes({list: announceList})
    this.log(`nodes selected to announce confirmation: %o`, partners.map(p => p.id))

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
    const successResponses = responses.filter(r => (r !== 'error'))
    if(successResponses.length < this.appParty!.t)
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

  async onFirstNodeRequestSucceed(request, availablePartners: string[]) {
    let tssPlugin = this.muon.getPlugin(`tss-plugin`)
    if(!tssPlugin.isReady){
      throw {message: 'Tss not initialized'};
    }

    let party = this.appParty;
    if(!party)
      throw {message: 'App party not generated'}

    let nonceParticipantsCount = Math.ceil(party.t * 1.2)
    this.log(`generating nonce with ${nonceParticipantsCount} partners.`)
    let nonce = await tssPlugin.keyGen(party, {
      id: `nonce-${request.reqId}`,
      partners: availablePartners,
      maxPartners: nonceParticipantsCount
    })
    this.log(`nonce generation has ben completed with address %s.`, tss.pub2addr(nonce.publicKey))

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
      // @ts-ignore
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

    let party = this.appParty
    let verifyingPubKey = this.appTss?.publicKey!

    signers = await this.requestManager.onRequestSignFullFilled(newRequest.reqId)

    let owners = Object.keys(signers)
    let allSignatures = owners.map(w => signers[w]);

    let schnorrSigns = allSignatures.map(({signature}) => {
      let [s, e] = signature.split(',').map(toBN);
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
        ownerPubKey: pub2json(verifyingPubKey, true),
        // signers: signersIndices,
        timestamp: getTimestamp(),
        signature: bn2hex(aggregatedSign.s),
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

  async recoverSignature(request, sign) {
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
    let nonce = await tssPlugin.getSharedKey(`nonce-${request.reqId}`)

    const ownerInfo = this.collateralPlugin.getNodeInfo(owner)
    if(!ownerInfo){
      this.log(`invalid signature owner %s`, owner)
      return false
    }
    let Z_i = pubKey;
    let K_i = nonce.getPubKey(ownerInfo!.id);

    const eInv = e.invm(tss.curve.n!)
    let p1 = tss.pointAdd(K_i, Z_i.mul(eInv)).encode('hex', true)
    let p2 = tss.curve.g.multiply(s).encode("hex", true);
    return p1 === p2 ? owner : null;
  }

  async verify(hash: string, signature: string, nonceAddress: string): Promise<boolean> {
    const signingPubKey = await this.findTssPublicKey();
    return tss.schnorrVerifyWithNonceAddress(hash, signature, nonceAddress, signingPubKey!);
  }

  async broadcastNewRequest(request) {
    let tssPlugin = this.muon.getPlugin('tss-plugin');
    let nonce: DistributedKey = await tssPlugin.getSharedKey(`nonce-${request.reqId}`, 15000)
    let party = this.appParty;
    if(!party)
      throw {message: `${this.ConstructorName}.broadcastNewRequest: app party has not value.`}
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
          this.log.error('asking signature for request failed %O', e)
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

    let {reqId} = request;
    let nonce = await this.tssPlugin.getSharedKey(`nonce-${reqId}`, 15000)
    if(!nonce)
      throw `nonce not found for request ${reqId}`

    // let tssKey = this.isBuiltInApp ? tssPlugin.tssKey : tssPlugin.getAppTssKey(this.APP_ID);
    let tssKey = this.appTss!;
    if(!tssKey)
      throw `App TSS key not found`;

    let k_i = nonce.share
    let K = nonce.publicKey!;

    await useDistributedKey(K.encode('hex', true), resultHash)
    // TODO: remove nonce after sign
    let signature = tss.schnorrSign(tssKey.share!, k_i!, K, resultHash)

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
      signature:`${bn2hex(signature.s)},${bn2hex(signature.e)}`
    }
  }

  async __onRemoteSignTheRequest(data: {sign: AppRequestSignature} | null, error) {
    // console.log('BaseAppPlugin.__onRemoteSignTheRequest', data)
    this.log(`remote ${data?.sign?.owner} signed the request.`)
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
        // let signer = await this.recoverSignature(request, sign)
        // if (signer && signer === sign.owner) {
          // @ts-ignore
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
        if(!ajv.validate(this.METHOD_PARAMS_SCHEMA[method], params)){
          // @ts-ignore
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

    for(let i=0 ; i<request.signatures.length ; i++) {
      if(!await this.verify(hash, request.signatures[i].signature, request.data.init.nonceAddress)) {
        throw `TSS signature not verified`
      }
    }
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

    for(let i=0 ; i<request.signatures.length ; i++) {
      if(!await this.verify(hash, request.signatures[i].signature, request.data.init.nonceAddress)) {
        throw `TSS signature not verified`
      }
    }

    await this.onConfirm(request, result, request.signatures);

    return `OK`;
  }

  @remoteMethod(RemoteMethods.HB)
  async __HB(data, callerInfo) {
    return true;
  }

  @remoteMethod(RemoteMethods.GetTssPublicKey)
  async __getTssPublicKey(data, callerInfo) {
    return this.appTss!.publicKey!.encode("hex", true)
  }
}

export default BaseAppPlugin;
