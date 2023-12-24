import CallablePlugin from './callable-plugin.js'
import {getTimestamp, pub2json, timeout} from '../../../utils/helpers.js'
import * as crypto from '../../../utils/crypto.js'
import {muonSha3} from '../../../utils/sha3.js'
import BN from "bn.js";
import * as TssModule from '../../../utils/tss/index.js'
import lodash from 'lodash'
import AppRequestManager from './app-request-manager.js'
import {remoteApp, remoteMethod, gatewayMethod} from './app-decorators.js'
import MemoryPlugin, {MemWriteOptions} from '../memory-plugin.js'
import { isArrowFn, deepFreeze } from '../../../utils/helpers.js'
import AppTssKey from "../../../utils/tss/app-tss-key.js";
import KeyManager from "../key-manager.js";
import AppManager from "../app-manager.js";
import NodeManagerPlugin from "../node-manager.js";
import {AppContext, AppRequest, MuonNodeInfo, Party} from "../../../common/types";
import {useOneTime} from "../../../utils/tss/use-one-time.js";
import chalk from 'chalk'
import {logger} from '@libp2p/logger'
import {bn2hex} from "../../../utils/tss/utils.js";
import * as NetworkIpc from "../../../network/ipc.js";
import {PublicKey} from "../../../utils/tss/types";
import {RedisCache} from "../../../common/redis-cache.js";
import axios from "axios";
import {GatewayCallParams} from "../../../gateway/types";
import {splitSignature, stringifySignature} from "../../../utils/tss/index.js";
import {reportConfirmFailure, reportInsufficientPartners, reportPartialSingMismatch} from "../../../common/analitics-reporter.js";
import {createAjv} from "../../../common/ajv.js";
import ethSigUtil from '@metamask/eth-sig-util'
import {coreRemoteMethodSchema as crms} from "../../remotecall-middlewares.js";
import {AppRequestSchema} from "../../../common/ajv-schemas.js";
import Web3 from 'web3'
import { MapOf } from '../../../common/mpc/types.js'
import { DEPLOYMENT_APP_ID } from '../../../common/contantes.js'
import AppNonceBatch from '../../../utils/tss/app-nonce-batch.js'

const { omit } = lodash;

const ajv = createAjv();
const clone = (obj) => JSON.parse(JSON.stringify(obj))
const requestConfirmationCache: RedisCache = new RedisCache('req-confirm', 3600)

const RemoteMethods = {
  AskSignature: 'AskSign',
  InformRequestConfirmation: 'InformReqConfirmation',
  PartialSignInfo: "partial-sing-info"
}

export type AppSignatureResponse = {
  result?: any,
  hash?: string,
  signature: string,
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
  useFrost: boolean = false;
  private nonceIndex:number = 0;

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
    this.log(`${this.ConstructorName}.onStart %o`, {appName: this.APP_NAME, appId: this.APP_ID})

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

    if(this.useFrost) {
      timeout(20e3 + Math.floor(Math.random()*10e3))
      .then(() => this.initializeFROST())
      .catch(e => {})

    }
  }

  async initializeFROST() {
    // this.keyManager.nonceGen()
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

  private getParty(seed: string): Party | undefined {
    return this.appManager.getAppParty(this.APP_ID, seed);
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
  async __defaultRequestHandler(callParams: GatewayCallParams): Promise<AppRequest> {
    const {method, params, mode, callId: gatewayCallId, gwSign, fee: feeParams} = callParams;

    this.log(`request arrived %o`, {method, params})
    let t0 = Date.now()
    let startedAt = getTimestamp()
    let deploymentSeed;

    if(!this.appManager.appIsDeployed(this.APP_ID))
      throw `App not deployed`;
    const oldestContext: AppContext = this.appManager.getAppOldestContext(this.APP_ID)!
    if(!this.appManager.appHasTssKey(this.APP_ID, oldestContext.seed)) {
      throw {
        message: `App tss not initialized`,
        node: this.currentNodeInfo?.id ?? null,
        seed: oldestContext?.seed ?? null
      }
    }
    deploymentSeed = oldestContext.seed;

    const nSign: number = this.getParty(deploymentSeed)!.t;

    if(this.METHOD_PARAMS_SCHEMA){
      if(this.METHOD_PARAMS_SCHEMA[method]){
        if(!ajv.validate(this.METHOD_PARAMS_SCHEMA[method], params)){
          // @ts-ignore
          throw ajv.errorsText(ajv.errors);
        }
      }
    }

    const feeData = !!feeParams ? {
      fee: {
        amount: 0,
        spender: {
          address: Web3.utils.toChecksumAddress(feeParams.spender),
          timestamp: feeParams.timestamp,
          signature: feeParams.signature
        },
        signature: ""
      }
    } : {};

    let newRequest:AppRequest = {
      confirmed: false,
      reqId: "",
      app: this.APP_NAME!,
      appId: this.APP_ID,
      method: method,
      deploymentSeed,
      nSign,
      gwAddress: process.env.SIGN_WALLET_ADDRESS!,
      data: {
        uid: gatewayCallId!,
        params,
        timestamp: startedAt,
        result: undefined,
        resultHash: "",
        signParams: [],
        init: {
          nonceAddress: ""
        },
        ...feeData,
      },
      startedAt,
      confirmedAt: 0,
      signatures: []
    }
    let t1= Date.now()

    /** view mode */
    if(mode === "view"){
      if(this.validateRequest){
        await this.validateRequest(clone(newRequest))
      }
      let result = await this.onRequest(clone(newRequest))
      this.resultChecking(result)
      newRequest.data.result = result
      return newRequest;
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
        newRequest = this.requestManager.getRequest(newRequest.reqId)!;
      }
      else {
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

        this.requestManager.addRequest(newRequest, {
          requestTimeout: this.requestTimeout, 
          isFrost: this.useFrost,
          partnerCount: availablePartners.length,
        });

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

        let sign: string = await this.makeSignature(newRequest, result, resultHash)
        this.requestManager.addSignature(newRequest.reqId, this.currentNodeInfo!.id, sign);
        // new Signature(sign).save()

        if(feeParams){
          const fee = await this.spendRequestFee(newRequest);

          if(fee) {
            // @ts-ignore
            newRequest.data.fee.amount = fee.amount
            // @ts-ignore
            newRequest.data.fee.signature = fee.sign
            await useOneTime('fee', fee.sign, newRequest.reqId)
          }
        }

        this.log('broadcasting request ...');
        await this.broadcastNewRequest(newRequest)
        t4 = Date.now()
      }

      let [confirmed, signatures] = await this.isOtherNodesConfirmed(newRequest)
      this.log(`confirmation done with %s`, confirmed)
      t5 = Date.now()

      if(this.useFrost) {
        this.log(`request signed with %o`, newRequest.data.init.noncePartners);
      }
      else {
        let nonce: AppTssKey = await this.keyManager.getSharedKey(`nonce-${newRequest.reqId}`, 15000, {type: "nonce", message: resultHash})
        this.log(`request signed with %o`, nonce.partners);
      }
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
        ...omit(newRequest, ['confirmed']),
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

      this.verifyFeeSig(request.reqId, feeResponse.amount, feeResponse.sign);

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

    const responses: string[] = await Promise.all(partners.map(node => (
      (
        node.wallet === process.env.SIGN_WALLET_ADDRESS
        ?
        this.__onRequestConfirmation(request, node)
        :
        this.remoteCall(
          node.peerId,
          RemoteMethods.InformRequestConfirmation,
          request,
          {taskId: `keygen-${nonce.id}`, timeout: 25e3}
        )
      )
      .then(() => "OK")
      .catch(e => {
        return `error: ${e.message}`
      })
    )))
    const reqConfirmResult:MapOf<string> = partners.reduce((obj, node, i) => {
      obj[node.id] = responses[i];
      return obj;
    }, {})
    if(Object.values(reqConfirmResult).filter(r => r !== "OK").length > 0) {
      this.log.error(`onConfirm failed on this nodes reqId:%s %o`, request.reqId, reqConfirmResult);
      if(this.APP_ID === DEPLOYMENT_APP_ID && ["deploy", "reshare"].includes(request.method)){
        reportConfirmFailure({
          callInfo: {
            app: request.app,
            method: request.method,
            params: request.data.params
          },
          reqId: request.reqId,
          partners: request.data.result.selectedNodes,
          shareHolders: Object.keys(request.data.init?.key?.shareProofs),
          onConfirm: reqConfirmResult
        })
          .catch(e => this.log.error(`error when reporting confirm failer %s`, e.message));
      }
    }
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
    const {appId, deploymentSeed: seed, data: {resultHash}} = request;

    if(!this.getTss(seed)){
      throw {message: 'App tss is not initialized', seed};
    }

    let party = this.getParty(seed);
    if(!party)
      throw {message: 'App party is not generated'}

    let nonceParticipantsCount = Math.ceil(party.t * 1.2)
    if(this.useFrost) {
      const currentNonce:number = this.nonceIndex++;
      const nonceBatch: AppNonceBatch = this.keyManager.appNonceBatches[appId][seed];
      const key: AppTssKey = this.getTss(seed)!;

      const {R} = TssModule.frostSignInit(
        resultHash, 
        key.publicKey,
        availablePartners, 
        nonceBatch.getCommitments(currentNonce, availablePartners)
      )

      return {
        nonceBatchId: nonceBatch.id,
        nonceIndex: currentNonce,
        noncePartners: availablePartners,
        nonceAddress: TssModule.pub2addr(R),
      }
    }
    else {
      this.log(`generating nonce with ${Math.min(nonceParticipantsCount, availablePartners.length)} partners.`)
      let nonce = await this.keyManager.keyGen({appId: this.APP_ID, seed}, {
        id: `nonce-${request.reqId}`,
        partners: availablePartners,
        maxPartners: nonceParticipantsCount,
        usage: {type: "nonce", message: request.data.resultHash},
      })
      this.log(`nonce generation has ben completed with address %s.`, TssModule.pub2addr(nonce.publicKey))

      return {
        nonceAddress: TssModule.pub2addr(nonce.publicKey),
      }
    }
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
    let {
      appId, 
      deploymentSeed: seed, 
      data:{
        init: {noncePartners}
      }
    } = newRequest;
    let party = this.getParty(newRequest.deploymentSeed)
    let verifyingPubKey = this.getTss(newRequest.deploymentSeed)?.publicKey!

    const signatures: MapOf<string> = await this.requestManager.onRequestSignFullFilled(newRequest.reqId)

    let owners = Object.keys(signatures)
    let allSignatures = noncePartners.map(id => signatures[id]);

    // console.log({
    //   owners,
    //   noncePartners,
    //   signatures,
    //   allSignatures
    // })

    let resultHash = this.hashAppSignParams(newRequest, newRequest.data.signParams, false)

    let aggregatedSign, confirmed;
    if(this.useFrost) {
      let frostSigns = allSignatures.map(signature => {
        return splitSignature(signature) as {R: PublicKey, s: BN};
      })
      aggregatedSign = TssModule.frostAggregateSigs(frostSigns);
      confirmed = TssModule.frostVerify(aggregatedSign, verifyingPubKey, resultHash)
    } 
    else{
      let schnorrSigns = allSignatures.map(signature => splitSignature(signature))
      const signersId = owners.map(wallet => this.nodeManager.getNodeInfo(wallet)!.id);
      aggregatedSign = TssModule.schnorrAggregateSigs(party!.t, schnorrSigns, signersId)
      // TODO: check more combination of signatures. some time one combination not verified bot other combination does.
      confirmed = TssModule.schnorrVerify(verifyingPubKey, resultHash, aggregatedSign)
    } 

    // TODO: check and detect nodes misbehavior if request not confirmed

    return [
      confirmed,
      confirmed ? [{
        owner: TssModule.pub2addr(verifyingPubKey),
        ownerPubKey: pub2json(verifyingPubKey, true),
        signature: bn2hex(aggregatedSign.s)
      }] : []
    ]
  }

  async recoverSignature(request: AppRequest, owner: string, signature: string) {
    let tt0 = Date.now();
    const appTssKey = this.getTss(request.deploymentSeed)!;

    // @ts-ignore
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
    const {appId, deploymentSeed: seed, data: {resultHash, init}} = request;
    const {useFrost} = this;

    const appTssKey = this.getTss(seed)!

    if(useFrost) {
      const {nonceIndex, noncePartners, } = init;
      const nonceBatch: AppNonceBatch = this.keyManager.appNonceBatches[appId][seed];
      return TssModule.frostVerifyPartial(
        TssModule.splitSignature(signature) as TssModule.FrostSign,
        appTssKey.publicKey,
        appTssKey.getPubKey(owner.id),
        noncePartners,
        noncePartners.findIndex(id => id === owner.id),
        nonceBatch.getCommitments(nonceIndex, noncePartners),
        resultHash,
      );
    }
    else {
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
  }

  async verify(deploymentSeed: string, hash: string, signature: string, nonceAddress: string): Promise<boolean> {
    const signingPubKey: PublicKey|null = await this.appManager.findAppPublicKey(this.APP_ID, deploymentSeed);
    if(!signingPubKey) {
      throw {
        message: `app[${this.APP_NAME}] tss publicKey not found`,
        node: this.currentNodeInfo?.id ?? null,
        appId: this.APP_ID,
        seed: deploymentSeed
      }
    }
    return TssModule.schnorrVerifyWithNonceAddress(hash, signature, nonceAddress, signingPubKey);
  }

  async broadcastNewRequest(request: AppRequest) {
    const {appId, deploymentSeed: seed} = request;
    let party = this.getParty(seed);
    if(!party)
      throw {message: `${this.ConstructorName}.broadcastNewRequest: app party has not value.`}

    let sidePartners: MuonNodeInfo[] = this.nodeManager.filterNodes({list: party.partners, excludeSelf: true});
    let taskId: string;
    if(this.useFrost) {
      const nonceBatch: AppNonceBatch = this.keyManager.appNonceBatches[appId][seed];
      sidePartners = sidePartners.filter((op: MuonNodeInfo) => nonceBatch.partners.includes(op.id))
    }
    else {
      let nonce: AppTssKey = await this.keyManager.getSharedKey(`nonce-${request.reqId}`, 15000, {type: "nonce", message: request.data.resultHash})
      sidePartners = sidePartners.filter((op: MuonNodeInfo) => nonce.partners.includes(op.id))
      taskId = `keygen-${nonce.id}`
    }

    this.requestManager.setPartnerCount(request.reqId, sidePartners.length + 1);
    // TODO: remove async
    sidePartners.map(async node => {
      return this.remoteCall(
          node.peerId,
          RemoteMethods.AskSignature,
          request,
          {
            timeout: this.REMOTE_CALL_TIMEOUT,
            taskId,
          }
        )
        .then((signResponse: AppSignatureResponse) => this.__onRemoteSignTheRequest({reqId: request.reqId, ...signResponse}, null, node))
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
    if(this.useFrost)
      return this.makeFrostSignature(request, result, resultHash);
    else
      return this.makeOldSignature(request, result, resultHash);
  }

  async makeOldSignature(request: AppRequest, result: any, resultHash): Promise<string> {
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

  async makeFrostSignature(request: AppRequest, result: any, resultHash): Promise<string> {
    let {
      reqId,
      appId, 
      deploymentSeed: seed,
      data:{
        init: {nonceIndex, noncePartners}
      }
    } = request;
    // let tssKey = this.isBuiltInApp ? this.keyManager.tssKey : this.keyManager.getAppTssKey(this.APP_ID);
    let tssKey: AppTssKey = this.getTss(request.deploymentSeed)!;
    if(!tssKey)
      throw `App TSS key not found`;
    /** Storing the TSS key usage for ever. */
    await useOneTime("key", tssKey.publicKey!.encode('hex', true), `app-${this.APP_ID}-tss`)

    let nonceBatch: AppNonceBatch = this.keyManager.appNonceBatches[appId][seed];
    if(!nonceBatch)
      throw `nonce not found for request ${reqId}`
    /**
     Storing the nonce usage for an hour.
     Each nonce will remain in the memory for 30 minutes. Therefore one hour is reasonable for keeping usage history.
     */
    // await useOneTime("key", K.encode('hex', true), `app-${this.APP_ID}-nonce-${resultHash}`, 3600)
    // TODO: remove nonce after sign
    let signature = TssModule.frostSign(
      resultHash,
      {share: tssKey.share, pubKey: tssKey.publicKey},
      nonceBatch.getNonce(nonceIndex),
      noncePartners,
      noncePartners.findIndex(id => this.currentNodeInfo?.id===id),
      nonceBatch.getCommitments(nonceIndex, noncePartners)
    )

    if(!process.env.SIGN_WALLET_ADDRESS){
      throw {message: "process.env.SIGN_WALLET_ADDRESS is not defined"}
    }

    return stringifySignature(signature);
  }

  async reportPartialMismatch(request: AppRequest, remoteNode: MuonNodeInfo, data: AppSignatureResponse) {
    const nodesToCheck = this.nodeManager.filterNodes({list: [remoteNode.id]});
    const partnersData = await Promise.all(
      nodesToCheck.map(node => {
        return this.remoteCall(
          node.peerId,
          RemoteMethods.PartialSignInfo,
          {appId: request.appId, seed: request.deploymentSeed},
          {timeout: 5000}
        )
        .catch(e => e.message)
      })
    )
    const key:AppTssKey = this.getTss(request.deploymentSeed)!;
    const nonce = await this.keyManager.getSharedKey(
      `nonce-${request.reqId}`,
      15000,
      {type: "nonce", message: request.data.resultHash},
    );
    return reportPartialSingMismatch({
      request,
      remoteNode: {
        id: remoteNode.id,
        ...data,
      },
      signatureData: {
        resultHash: request.data.resultHash,
        key: key.toJson().polynomial!,
        nonce: nonce.toJson().polynomial!,
        partners: partnersData.reduce((obj, curr, i) => (obj[nodesToCheck[i].id]=curr, obj), {}),
      },
    })
  }

  async __onRemoteSignTheRequest(data: ({reqId: string} & AppSignatureResponse) | null, error, remoteNode: MuonNodeInfo) {
    if(error){
      this.log.error(`node ${remoteNode.id} unable to sign the request. %O`, error)
      let {request: reqId, ...otherParts} = error;
      let request = this.requestManager.getRequest(reqId);
      if(request) {
        this.requestManager.addError(reqId, remoteNode.id, otherParts);
      }
      return;
    }
    try {
      this.log(`node ${remoteNode.id} signed the request.`)
      let {reqId, signature, result, hash} = data!;
      let request:AppRequest = this.requestManager.getRequest(reqId) as AppRequest
      if (request) {
        /**
         * alice-v1 deployment key is old and does not have polynomial info.
         * disable verification temporarily for deployment.
         * */
        // let signatureVerified = request.appId === "1" || (await this.verifyPartialSignature(request, remoteNode, sign))
        let signatureVerified = await this.verifyPartialSignature(request, remoteNode, signature)
        if (signatureVerified) {
          this.requestManager.addSignature(request.reqId, remoteNode.id, signature)
        }
        else {
          this.log.error('partial signature mismatch %o', {reqId: request.reqId, signature, signer: remoteNode.id})
          this.requestManager.addError(reqId, remoteNode.id, {message: "partial signature mismatch"});
          this.reportPartialMismatch(request, remoteNode, data!)
            .catch(e => this.log(`partial signature mismatch resport error: %s`, e.message));
        }
      }
      else{
        this.log(`Request not found id:${reqId}`);
        this.requestManager.addError(reqId, remoteNode.id, {message: "request not found"});
      }
    }
    catch (e) {
      this.log.error('onRemoteSignTheRequest', e);
      this.requestManager.addError(data?.reqId, remoteNode.id, {message: e.message});
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
          throw ajv.errorsText(ajv.errors);
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
      if(!await this.verify(_request.deploymentSeed, hash, request.signatures[i].signature, request.data.init.nonceAddress)) {
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
      if(!await this.verify(request.deploymentSeed, hash!, request.signatures[i].signature, request.data.init.nonceAddress)) {
        return false
      }
    }

    return true;
  }

  @remoteMethod(RemoteMethods.AskSignature, crms(AppRequestSchema))
  async __askSignature(request: AppRequest, callerInfo): Promise<AppSignatureResponse> {
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
      let {amount, signature} = request.data.fee;
      this.verifyFeeSig(request.reqId, amount, signature);
      await useOneTime('fee', signature, request.reqId);
    }

    return {
      result,
      hash,
      signature: await this.makeSignature(request, result, hash)!
    }
  }

  @remoteMethod(RemoteMethods.InformRequestConfirmation, crms(AppRequestSchema))
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

  @remoteMethod(RemoteMethods.PartialSignInfo)
  async __getPartialSignInfo(data: {appId: string, seed: string}, callerInfo: MuonNodeInfo) {
    return this.appManager.getAppTssKey(data.appId, data.seed)?.keyShare;
  }

  verifyFeeSig(requestId, amount, signature) {
    const feeConfigs = this.muon.configs.net.fee;
    const hash = muonSha3(
      {type: "uint256", value: requestId},
      {type: "uint256", value: amount}
    );
    const recoveredSigner = crypto.recover(hash, signature);
    if (feeConfigs && !feeConfigs.signers.includes(recoveredSigner)) {
      throw `fee signature mismatched.`
    }
  }
}

export default BaseAppPlugin;
