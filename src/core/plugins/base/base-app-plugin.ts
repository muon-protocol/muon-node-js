import CallablePlugin from './callable-plugin.js'
import Request from '../../../common/db-models/Request.js'
import {getTimestamp, pub2json} from '../../../utils/helpers.js'
import * as crypto from '../../../utils/crypto.js'
import {muonSha3} from '../../../utils/sha3.js'
import * as TssModule from '../../../utils/tss/index.js'
import lodash from 'lodash'
import AppRequestManager from './app-request-manager.js'
import {remoteApp, remoteMethod, gatewayMethod} from './app-decorators.js'
import MemoryPlugin, {MemWriteOptions} from '../memory-plugin.js'
import { isArrowFn, deepFreeze } from '../../../utils/helpers.js'
import AppTssKey from "../../../utils/tss/app-tss-key.js";
import KeyManager from "../key-manager.js";
import AppManager from "../app-manager.js";
import TssParty from "../../../utils/tss/party.js";
import NodeManagerPlugin from "../node-manager.js";
import {AppContext, AppRequest, MuonNodeInfo} from "../../../common/types";
import {useOneTime} from "../../../utils/tss/use-one-time.js";
import chalk from 'chalk'
import {logger} from '@libp2p/logger'
import {bn2hex} from "../../../utils/tss/utils.js";
import * as NetworkIpc from "../../../network/ipc.js";
import {PublicKey} from "../../../utils/tss/types";
import {RedisCache} from "../../../common/redis-cache.js";
import axios from "axios";
import {GatewayCallParams} from "../../../gateway/types";
import {MapOf} from "../../../common/mpc/types";
import {splitSignature, stringifySignature} from "../../../utils/tss/index.js";
import {reportInsufficientPartners} from "../../../common/analitics-reporter.js";
import {createAjv} from "../../../common/ajv.js";
import ethSigUtil from '@metamask/eth-sig-util'

const { omit } = lodash;

const ajv = createAjv();
const clone = (obj) => JSON.parse(JSON.stringify(obj))
const requestConfirmationCache: RedisCache = new RedisCache('req-confirm', 3600)

const RemoteMethods = {
  AskSignature: 'AskSign',
  InformRequestConfirmation: 'InformReqConfirmation',
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
  /** multiple group can be returned in order to check separately in confirmation check */
  getConfirmAnnounceGroups: (request: object) => Promise<string[][]>;
  onConfirm: (request: object, result: any, signatures: any[]) => void;
  METHOD_PARAMS_SCHEMA: object = {};
  /**=================================*/
  APP_NAME: string | null = null
  REMOTE_CALL_TIMEOUT = 60000
  /** default value will apply from ./config/global/[default.]net.conf.json {tss.defaultTTL} */
  TTL: number;
  requestManager = new AppRequestManager();
  /** initialize when loading */
  isBuiltInApp: boolean
  private log;

  constructor(muon, configs) {
    super(muon, configs);
    this.log = logger("muon:apps:base")
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
      "signParams",
    ])
    this.warnArrowFunctions(this.readOnlyMethods);

    if(this.onAppInit)
      this.onAppInit();
  }

  async onStart() {
    await super.onStart();
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
    await this.nodeManager.waitToLoad();

    for(const seed of this.appManager.getAppSeeds(this.APP_ID)) {
      const appParty = this.keyManager.getAppParty(this.APP_ID, seed);
      if(appParty) {
        this.log(`App party loaded %s`, appParty.id)
      }
    }
  }

  get keyManager(): KeyManager{
    return this.muon.getPlugin('key-manager');
  }

  get nodeManager(): NodeManagerPlugin{
    return this.muon.getPlugin('node-manager');
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

  private getParty(seed: string): TssParty | null | undefined {
    return this.keyManager.getAppParty(this.APP_ID, seed);
  }

  private getTss(seed: string): AppTssKey | null {
    return this.keyManager.getAppTssKey(this.APP_ID, seed)
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

  private resultChecking(result) {
    /** Serialization and deserialization must work on the request result. */
    try {
      JSON.parse(JSON.stringify(result))
    }
    catch (e) {
      throw `App result serialize/deserialize error: ${e.message}`;
    }
  }

  @gatewayMethod("default")
  async __defaultRequestHandler(callParams: GatewayCallParams) {
    const {method, params, mode, callId: gatewayCallId, gwSign, fee: feeParams} = callParams;

    this.log(`request arrived %o`, {method, params})
    let t0 = Date.now()
    let startedAt = getTimestamp()
    let deploymentSeed;

    if(this.APP_ID === '1') {
      if (!this.keyManager.isReady)
        throw {message: "Deployment tss is not initialized"}
      /**
       deployer list load's from contract and has'nt deployment request and seed.
       default seed for deployment context is `1`
       */
      deploymentSeed = "1"
    }
    else{
      if(!this.appManager.appIsDeployed(this.APP_ID))
        throw `App not deployed`;
      const oldestContext: AppContext = this.appManager.getAppOldestContext(this.APP_ID)!
      if(!this.appManager.appHasTssKey(this.APP_ID, oldestContext.seed)) {
        throw `App tss not initialized currentNode: ${process.env.SIGN_WALLET_ADDRESS} seed: ${oldestContext.seed}`
      }
      deploymentSeed = oldestContext.seed;
    }

    const nSign = this.getParty(deploymentSeed)!.t;

    if(this.METHOD_PARAMS_SCHEMA){
      if(this.METHOD_PARAMS_SCHEMA[method]){
        if(!ajv.validate(this.METHOD_PARAMS_SCHEMA[method], params)){
          // @ts-ignore
          throw ajv.errors.map(e => e.message).join("\n");
        }
      }
    }

    const feeData = !!feeParams ? {
      fee: {
        amount: "",
        spender: {
          address: feeParams.spender,
          timestamp: feeParams.timestamp,
          signature: feeParams.signature
        },
        signature: ""
      }
    } : {}

    let newRequest = new Request({
      reqId: null,
      app: this.APP_NAME,
      appId: this.APP_ID,
      method: method,
      deploymentSeed,
      nSign,
      gwAddress: process.env.SIGN_WALLET_ADDRESS,
      // peerId: process.env.PEER_ID,
      data: {
        uid: gatewayCallId,
        params,
        timestamp: startedAt,
        ...feeData,
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
      this.resultChecking(result)
      newRequest.data.result = result
      return omit(newRequest._doc, ['__v'])
    }
    /** sign mode */
    else{
      let t0 = Date.now(), t1, t2, t3, t4, t5, t6;
      let appParty = this.getParty(deploymentSeed)!;

      if(this.validateRequest){
        this.log(`calling validateRequest ...`)
        await this.validateRequest(clone(newRequest))
        this.log(`calling validateRequest done successfully.`)
      }
      if(this.onArrive){
        this.log(`calling onArrive ...`)
        try {
          newRequest.data.init = await this.onArrive(clone(newRequest))
        }
        catch (e) {
          this.log.error("error calling onArrive %O", e)
          throw e;
        }
        this.log(`calling onArrive done successfully.`)
      }

      this.log(`calling onRequest ...`)
      let result;
      try {
        result = await this.onRequest(clone(newRequest))
        this.resultChecking(result)
      }
      catch (e) {
        this.log.error("error calling onRequest %O", e)
        throw e;
      }
      this.log(`app result: %o`, result)
      newRequest.data.result = result

      let resultHash;

      this.log(`calling signParams ...`)
      const appSignParams = this.signParams(newRequest, result)
      this.log(`calling signParams done successfully.`)
      const resultHashWithoutSecurityParams = this.hashAppSignParams(newRequest, appSignParams, false);
      newRequest.reqId = this.calculateRequestId(newRequest, resultHashWithoutSecurityParams)
      newRequest.data.signParams = this.appendSecurityParams(newRequest, appSignParams)
      resultHash = this.hashAppSignParams(newRequest, appSignParams)
      newRequest.data.resultHash = resultHash;

      let isDuplicateRequest = false;
      if(this.requestManager.hasRequest(newRequest.reqId)){
        isDuplicateRequest = true;
        newRequest = this.requestManager.getRequest(newRequest.reqId);
      }
      else {
        this.requestManager.addRequest(newRequest, {requestTimeout: this.requestTimeout});

        /** find available partners to sign the request */
        const availableCount = Math.min(
          Math.ceil(appParty.t*1.5),
          appParty.partners.length,
        );
        const {availables: availablePartners, minGraph, graph} = await this.appManager.findOptimalAvailablePartners(
          this.APP_ID,
          deploymentSeed,
          availableCount,
        );

        t1 = Date.now();
        this.log(`partners:[%o] are available to sign the request`, availablePartners)
        if(availablePartners.length < appParty.t) {
          /** send analytic data to server */
          reportInsufficientPartners({graph, minGraph, count: availableCount})
            .catch(e => this.log.error(`error reporting insufficient partners %o`, e))
          throw `Insufficient partner to sign the request, needs ${appParty.t} but only ${availablePartners.length} are available`
        }

        t2 = Date.now()
        newRequest.data.init = {
          ... newRequest.data.init,
          ... await this.onFirstNodeRequestSucceed(clone(newRequest), availablePartners)
        };
        t3 = Date.now();

        // await newRequest.save()

        let sign: string = await this.makeSignature(newRequest, result, resultHash)
        this.requestManager.addSignature(newRequest.reqId, process.env.SIGN_WALLET_ADDRESS!, sign);
        // new Signature(sign).save()

        const fee = await this.spendRequestFee(newRequest);

        if(fee) {
          newRequest.data.fee.amount = fee.amount
          newRequest.data.fee.signature = fee.sign
          await useOneTime('fee', fee.sign, newRequest.reqId)
        }

        this.log('broadcasting request ...');
        await this.broadcastNewRequest(newRequest)
        t4 = Date.now()
      }

      let [confirmed, signatures] = await this.isOtherNodesConfirmed(newRequest)
      this.log(`confirmation done with %s`, confirmed)
      t5 = Date.now()

      let nonce: AppTssKey = await this.keyManager.getSharedKey(`nonce-${newRequest.reqId}`, 15000, {type: "nonce", message: resultHash})
      this.log(`request signed with %o`, nonce.partners);
      this.log('request time parts %o',{
        "req exec time": t1-t0,
        "find online nodes": t2-t1,
        "dkg time": t3-t2,
        "req broadcast": t4-t3,
        "confirm waiting": t5-t4,
      })

      if (confirmed) {
        newRequest['confirmedAt'] = getTimestamp()
      }

      let requestData: any = {
        confirmed,
        ...omit(newRequest._doc, [
          '__v',
          '_id'
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
          this.informRequestConfirmation(requestData)
            .catch(e => {
              this.log.error("error when informing request confirmation %O", e)
            })
        }

        /** send request data to aggregator nodes */
        this.log('sending request to aggregator nodes ...')
        NetworkIpc.sendToAggregatorNode("AppRequest", requestData)
          .then(aggregatorNodeIdList => {
            this.log(`request sent to aggregator nodes: %o`, aggregatorNodeIdList)
          })
          .catch(e => {
            this.log(`error when sending request to aggregator nodes %o`, e)
          })

        /** store data locally */
        newRequest.save()
      }

      return requestData
    }
  }

  async spendRequestFee(request: AppRequest) {
    let {fee} = request.data;
    const feeConfigs = this.muon.configs.net.fee;
    if(fee && feeConfigs) {
      this.log(`spending fee %o`, fee)
      const {spender} = fee;
      spender.address = spender.address.toLowerCase();
      const appId = this.APP_ID;

      /** fee signature is valid for 5 minutes */
      if(spender.timestamp/1000 < request.data.timestamp-5*60)
        throw `fee spend time has been expired.`

      const eip712TypedData = {
        types: {
          EIP712Domain: [{name: 'name', type: 'string'}],
          Message: [
            {type: 'address', name: 'address'},
            {type: 'uint64', name: 'timestamp'},
            {type: 'uint256', name: 'appId'},
          ]
        },
        domain: {name: 'Muonize'},
        primaryType: 'Message',
        message: {address: spender.address, timestamp: spender.timestamp, appId}
      };

      // @ts-ignore
      let signer = ethSigUtil.recoverTypedSignature({data: eip712TypedData, signature: spender.signature, version: "V4"});

      signer = signer.toLowerCase();
      if(signer !== spender.address)
        throw `fee spender not matched with signer.`;

      /** spend fee */
      const {endpoint, signers: feeSigners} = feeConfigs
      let feeResponse = await axios.post(
        endpoint,
        {
          request: request.reqId,
          spender: spender.address,
          timestamp: spender.timestamp,
          appId,
          sign: spender.signature,
        },
      )
        .then(({data}) => data)
        .catch(e => {
          return {
            error: e?.response?.data?.error || e?.message || "unknown error when spending request fee"
          }
        })
      this.log(`fee server response %o`, feeResponse)

      if(feeResponse.error)
        throw feeResponse.error;

      /** check fee server response */
      const feeAmount: number = parseInt(feeResponse.amount)
      if(feeAmount <= 0)
        throw `unable to spend request fee.`

      return feeResponse;
    }

    return undefined;
  }

  async informRequestConfirmation(request: AppRequest) {
    request = clone(request)
    // await this.onConfirm(request)
    let nonce: AppTssKey = await this.keyManager.getSharedKey(`nonce-${request.reqId}`, undefined, {type: "nonce", message: request.data.resultHash})!;

    let announceList = this.getParty(request.deploymentSeed)!.partners;
    if(!!this.getConfirmAnnounceGroups) {
      const announceGroups: string[][] = await this.getConfirmAnnounceGroups(request);
      const moreAnnounceList: string[] = ([] as string[]).concat(...announceGroups)
      this.log(`custom announce list: %o`, moreAnnounceList)
      if(Array.isArray(moreAnnounceList)) {
        /** ignore if array contains non string item */
        if(moreAnnounceList.findIndex(n => (typeof n !== "string")) < 0) {
          announceList = [
            ... announceList,
            ... moreAnnounceList
          ]
        }
      }
    }

    const partners: MuonNodeInfo[] = this.nodeManager.filterNodes({list: announceList})
    this.log(`nodes selected to announce confirmation: %o`, partners.map(p => p.id))

    const responses: string[] = await Promise.all(partners.map(async node => {
      if(node.wallet === process.env.SIGN_WALLET_ADDRESS) {
        return this.__onRequestConfirmation(request, node)
          .catch(e => {
            this.log.error(`informRequestConfirmation error %o`, e)
            return 'error'
          })
      }
      else {
        return this.remoteCall(
          node.peerId,
          RemoteMethods.InformRequestConfirmation,
          request,
          {taskId: `keygen-${nonce.id}`, timeout: 10e3}
        )
          .catch(e => {
            this.log.error(`informRequestConfirmation error %o`, e)
            return 'error'
          })
      }
    }))
    const successResponses = responses.filter(r => (r !== 'error'))
    if(successResponses.length < this.getParty(request.deploymentSeed)!.t)
      throw `Error when informing request confirmation.`
  }

  calculateRequestId(request, resultHash) {
    return muonSha3(
      {type: "address", value: request.gwAddress},
      {type: "uint256", value: muonSha3(request.data.uid)},
      {type: "uint32", value: request.data.timestamp},
      {type: "uint256", value: request.appId},
      {type: "string", value: muonSha3(request.method)},
      {type: "uint256", value: resultHash},
    );
  }

  async onFirstNodeRequestSucceed(request: AppRequest, availablePartners: string[]) {
    const seed = request.deploymentSeed;

    if(!this.getTss(seed)){
      throw {message: 'App tss is not initialized', seed};
    }

    let party = this.getParty(seed);
    if(!party)
      throw {message: 'App party is not generated'}

    let nonceParticipantsCount = Math.ceil(party.t * 1.2)
    this.log(`generating nonce with ${Math.min(nonceParticipantsCount, availablePartners.length)} partners.`)
    let nonce = await this.keyManager.keyGen({appId: this.APP_ID, seed}, {
      id: `nonce-${request.reqId}`,
      partners: availablePartners,
      maxPartners: nonceParticipantsCount,
      usage: {type: "nonce", message: request.data.resultHash},
    })
    this.log(`nonce generation has ben completed with address %s.`, TssModule.pub2addr(nonce.publicKey))

    // let sign = this.keyManager.sign(null, party);
    return {
      nonceAddress: TssModule.pub2addr(nonce.publicKey),
    }
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

  async isOtherNodesConfirmed(newRequest: AppRequest) {
    let signers = {}

    let party = this.getParty(newRequest.deploymentSeed)
    let verifyingPubKey = this.getTss(newRequest.deploymentSeed)?.publicKey!

    signers = await this.requestManager.onRequestSignFullFilled(newRequest.reqId)

    let owners = Object.keys(signers)
    let allSignatures = owners.map(w => signers[w]);

    let schnorrSigns = allSignatures.map(signature => splitSignature(signature))

    const ownersIndex = owners.map(wallet => this.nodeManager.getNodeInfo(wallet)!.id);
    let aggregatedSign = TssModule.schnorrAggregateSigs(party!.t, schnorrSigns, ownersIndex)
    let resultHash = this.hashAppSignParams(newRequest, newRequest.data.signParams, false)

    // TODO: check more combination of signatures. some time one combination not verified bot other combination does.
    let confirmed = TssModule.schnorrVerify(verifyingPubKey, resultHash, aggregatedSign)
    // TODO: check and detect nodes misbehavior if request not confirmed

    return [
      confirmed,
      confirmed ? [{
        owner: TssModule.pub2addr(verifyingPubKey),
        ownerPubKey: pub2json(verifyingPubKey, true),
        // signers: signersIndices,
        signature: bn2hex(aggregatedSign.s),
        // sign: {
        //   s: `0x${aggregatedSign.s.toString(16)}`,
        //   e: `0x${aggregatedSign.e.toString(16)}`
        // },
      }] : []
    ]
  }

  async recoverSignature(request: AppRequest, owner: string, signature: string) {
    let tt0 = Date.now();
    const appTssKey = this.getTss(request.deploymentSeed)!
    // TODO: need to recheck
    // if(owner !== TssModule.pub2addr(pubKey)) {
    //   console.log({owner, pubKeyStr,})
    //   throw {message: 'Sign recovery error: invalid pubKey address'}
    // }

    let {s, e} = splitSignature(signature)
    //
    let nonce: AppTssKey = await this.keyManager.getSharedKey(`nonce-${request.reqId}`, undefined, {type: "nonce", message: request.data.resultHash})

    const ownerInfo = this.nodeManager.getNodeInfo(owner)
    if(!ownerInfo){
      this.log(`invalid signature owner %s`, owner)
      return false
    }
    let Z_i = appTssKey.getPubKey(ownerInfo!.id);
    let K_i = nonce.getPubKey(ownerInfo!.id);

    const eInv = e.invm(TssModule.curve.n!)
    let p1 = TssModule.pointAdd(K_i, Z_i.mul(eInv)).encode('hex', true)
    let p2 = TssModule.curve.g.multiply(s).encode("hex", true);
    return p1 === p2 ? owner : null;
  }

  async verifyPartialSignature(request: AppRequest, owner:MuonNodeInfo, signature: string): Promise<boolean> {
    const appTssKey = this.getTss(request.deploymentSeed)!
    let nonce: AppTssKey = await this.keyManager.getSharedKey(`nonce-${request.reqId}`, undefined, {type: "nonce", message: request.data.resultHash})

    return TssModule.schnorrVerifyPartial(
      appTssKey.getPubKey(owner.id),
      appTssKey.publicKey,
      nonce.getPubKey(owner.id),
      nonce.publicKey,
      request.data.resultHash,
      signature,
    );
  }

  async verify(hash: string, signature: string, nonceAddress: string): Promise<boolean> {
    const signingPubKey: MapOf<PublicKey> = await this.appManager.findAppPublicKeys(this.APP_ID);
    if(Object.keys(signingPubKey).length < 1)
      throw `app[${this.APP_NAME}] tss publicKey not found`
    // @ts-ignore
    for(const publicKey of Object.values(signingPubKey)) {
      if(TssModule.schnorrVerifyWithNonceAddress(hash, signature, nonceAddress, publicKey))
        return true;
    }
    return false
  }

  async broadcastNewRequest(request: AppRequest) {
    let nonce: AppTssKey = await this.keyManager.getSharedKey(`nonce-${request.reqId}`, 15000, {type: "nonce", message: request.data.resultHash})
    let party = this.getParty(request.deploymentSeed);
    if(!party)
      throw {message: `${this.ConstructorName}.broadcastNewRequest: app party has not value.`}
    let partners: MuonNodeInfo[] = this.nodeManager.filterNodes({list: party.partners})
      .filter((op: MuonNodeInfo) => {
        return op.wallet !== process.env.SIGN_WALLET_ADDRESS && nonce.partners.includes(op.id)
      })

    this.requestManager.setPartnerCount(request.reqId, partners.length + 1);

    // TODO: remove async
    partners.map(async node => {
      return this.remoteCall(
          node.peerId,
          RemoteMethods.AskSignature,
          request,
          {
            timeout: this.REMOTE_CALL_TIMEOUT,
            taskId: `keygen-${nonce.id}`
          }
        )
        .then(sign => this.__onRemoteSignTheRequest({reqId: request.reqId, sign}, null, node))
        .catch(e => {
          this.log.error('asking signature for request failed %O', e)
          return this.__onRemoteSignTheRequest(null, {
            request: request.reqId,
            ...e
          }, node);
        })
    })
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
      return muonSha3(...signParams)
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

  async makeSignature(request: AppRequest, result: any, resultHash): Promise<string> {
    let {reqId} = request;
    let nonce: AppTssKey = await this.keyManager.getSharedKey(
      `nonce-${reqId}`,
      15000,
      {type: "nonce", message: request.data.resultHash},
    );
    if(!nonce)
      throw `nonce not found for request ${reqId}`

    // let tssKey = this.isBuiltInApp ? this.keyManager.tssKey : this.keyManager.getAppTssKey(this.APP_ID);
    let tssKey: AppTssKey = this.getTss(request.deploymentSeed)!;
    if(!tssKey)
      throw `App TSS key not found`;

    let k_i = nonce.share
    let K = nonce.publicKey!;

    /** Storing the TSS key usage for ever. */
    await useOneTime("key", tssKey.publicKey!.encode('hex', true), `app-${this.APP_ID}-tss`)
    /**
     Storing the nonce usage for an hour.
     Each nonce will remain in the memory for 30 minutes. Therefore one hour is reasonable for keeping usage history.
     */
    await useOneTime("key", K.encode('hex', true), `app-${this.APP_ID}-nonce-${resultHash}`, 3600)
    // TODO: remove nonce after sign
    let signature = TssModule.schnorrSign(tssKey.share!, tssKey.publicKey, k_i!, K, resultHash)

    if(!process.env.SIGN_WALLET_ADDRESS){
      throw {message: "process.env.SIGN_WALLET_ADDRESS is not defined"}
    }

    return stringifySignature(signature);
  }

  async __onRemoteSignTheRequest(data: {reqId: string, sign: string} | null, error, remoteNode: MuonNodeInfo) {
    if(error){
      this.log.error(`node ${remoteNode.id} unable to sign the request. %O`, error)
      let {request: reqId, ...otherParts} = error;
      let request = this.requestManager.getRequest(reqId);
      if(request) {
        this.requestManager.addError(reqId, remoteNode.wallet, otherParts);
      }
      return;
    }
    try {
      this.log(`node ${remoteNode.id} signed the request.`)
      let {reqId, sign} = data!;
      let request:AppRequest = this.requestManager.getRequest(reqId) as AppRequest
      if (request) {
        /**
         * alice-v1 deployment key is old and does not have polynomial info.
         * disable verification temporarily for deployment.
         * */
        let signatureVerified = request.appId === "1" || (await this.verifyPartialSignature(request, remoteNode, sign))
        if (signatureVerified) {
          this.requestManager.addSignature(request.reqId, remoteNode.wallet, sign)
        }
        else {
          this.log.error('partial signature mismatch %o', {reqId: request.reqId, sign, signer: remoteNode.id})
          this.requestManager.addError(reqId, remoteNode.wallet, {message: "partial signature mismatch"});
        }
      }
      else{
        this.log(`Request not found id:${reqId}`)
      }
    }
    catch (e) {
      this.log.error('onRemoteSignTheRequest', e);
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

  async preProcessRemoteRequest(request, validation:boolean=true) {
    const {method, data: {params={}}} = request
    /**
     * Check request timestamp
     */
    if(validation && getTimestamp() - request.data.timestamp > this.REMOTE_CALL_TIMEOUT/1000) {
      throw "Request timestamp expired to sign."
    }

    /**
     * validate params schema
     */
    if(validation && this.METHOD_PARAMS_SCHEMA){
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
    if(validation && this.validateRequest){
      await this.validateRequest(request)
    }
    /**
     * Check request result to be same.
     */
    let result = await this.onRequest(request)
    this.resultChecking(result)

    const appSignParams = this.signParams(request, result)
    const resultHashWithoutSecurityParams = this.hashAppSignParams(request, appSignParams, false)
    let reqId = this.calculateRequestId(request, resultHashWithoutSecurityParams);

    let hash1 = this.hashAppSignParams(request, request.data.signParams, false)
    let hash2 = this.hashAppSignParams(request, appSignParams)

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

  /**
   * check signature to be matched with request result
   * @param _request
   */
  async verifyRequestSignature(_request: AppRequest): Promise<boolean> {
    const request:AppRequest = clone(_request)
    deepFreeze(request);

    // const [result, hash] = await this.preProcessRemoteRequest(request);
    const {result, signParams} = _request.data
    const hash = this.hashAppSignParams(request, signParams, false)!

    for(let i=0 ; i<request.signatures.length ; i++) {
      if(!await this.verify(hash, request.signatures[i].signature, request.data.init.nonceAddress)) {
        throw `TSS signature not verified`
      }
    }

    return true;
  }

  /**
   * All signatures will be checked to be matched with the result.
   * @param request {AppRequest} - confirmed app request
   * @param validation {boolean} - if false, request validation will not be checked.
   */
  async verifyCompletedRequest(request: AppRequest, validation:boolean=true): Promise<boolean> {
    const {result} = request.data;

    const signParams = this.signParams(request, result)
    const hash = this.hashAppSignParams(request, signParams)

    for(let i=0 ; i<request.signatures.length ; i++) {
      if(!await this.verify(hash!, request.signatures[i].signature, request.data.init.nonceAddress)) {
        return false
      }
    }

    return true;
  }

  @remoteMethod(RemoteMethods.AskSignature)
  async __askSignature(request: AppRequest, callerInfo) {
    this.log(`remote node [id:${callerInfo.id}] wants signature %o`, request)
    deepFreeze(request);
    /**
     * Check request owner
     */
    if(request.gwAddress !== callerInfo.wallet){
      throw "Only request owner can ask signature."
    }

    /**
     * Check to ensure the current node exists in the app party.
     */
    const context = this.appManager.getAppContext(this.APP_ID, request.deploymentSeed)
    if(!context)
      throw `Missing app context`
    const currentNodeInfo = this.nodeManager.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)!
    if(!context.party.partners.includes(currentNodeInfo.id))
      throw `Current node does not exist in the app party`
    if(!this.getTss(request.deploymentSeed))
      throw `Missing app tss key`

    const [result, hash] = await this.preProcessRemoteRequest(request);

    /** fee checking */
    if(request.data.fee) {
      const feeConfigs = this.muon.configs.net.fee;
      let {amount, signature} = request.data.fee;
      const hash = muonSha3(
        { type: "uint256", value: request.reqId },
        { type: "uint256", value: amount }
      )
      const signer = crypto.recover(hash, signature)
      if(feeConfigs && !feeConfigs.signers.includes(signer)) {
        throw `fee consumption signature mismatched.`
      }
      await useOneTime('fee', signature, request.reqId);
    }

    return this.makeSignature(request, result, hash)
  }

  @remoteMethod(RemoteMethods.InformRequestConfirmation)
  async __onRequestConfirmation(request: AppRequest, callerInfo) {
    if(!this.onConfirm)
      return `onConfirm not defined for this app`;

    deepFreeze(request);
    /**
     * Check request owner
     */
    if(request.gwAddress !== callerInfo.wallet){
      throw "Only request owner can inform confirmation."
    }


    this.log(`verifying confirmed request. %o`, {app: request.app, method: request.method, params: request?.data?.params})
    const isValid = await this.verifyCompletedRequest(request);
    if(!isValid) {
      throw `TSS signature not verified`
    }

    this.log('calling onConfirm ...')
    try {
      await this.onConfirm(request, request.data.result, request.signatures)
    }
    catch (e) {
      this.log.error("error calling onConfirm %O", e)
      throw e;
    }
    this.log('calling onConfirm done successfully.')

    await requestConfirmationCache.set(request.reqId, '1');

    return `OK`;
  }
}

export default BaseAppPlugin;
