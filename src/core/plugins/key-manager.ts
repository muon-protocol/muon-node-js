import CallablePlugin from './base/callable-plugin.js'
import AppTssKey from "../../utils/tss/app-tss-key.js";
import lodash from 'lodash'
import * as TssModule from '../../utils/tss/index.js'
import {uuid} from '../../utils/helpers.js'
import {remoteApp, remoteMethod} from './base/app-decorators.js'
import NodeManagerPlugin from "./node-manager.js";
import * as SharedMemory from '../../common/shared-memory/index.js'
import * as NetworkIpc from '../../network/ipc.js'
import * as CoreIpc from "../ipc.js";
import {AppContext, MpcType, MuonNodeInfo, PartyInfo} from "../../common/types";
import AppManager from "./app-manager.js";
import {IMpcNetwork, MapOf} from "../../common/mpc/types";
import {DistributedKeyGeneration} from "../../common/mpc/dkg.js";
import {DistKey} from "../../common/mpc/dist-key.js";
import {logger} from '@libp2p/logger'
import {KeyReDistOpts, KeyRedistribution} from "../../common/mpc/kdist.js";
import MpcNetworkPlugin from "./mpc-network";
import {PublicKey} from "../../utils/tss/types";
import * as crypto from "../../utils/crypto.js";
import {muonSha3} from "../../utils/sha3.js";
import {bn2hex} from "../../utils/tss/utils.js";
import { FrostCommitment, FrostCommitmentJson, FrostNonce, FrostNonceJson, NonceBatch, NonceBatchJson } from '../../common/mpc/dist-nonce.js';
import { DistributedNonceGeneration } from '../../common/mpc/dng.js';
import AppNonceBatch, { AppNonceBatchJson } from '../../utils/tss/app-nonce-batch.js';
import { Mutex } from '../../common/mutex.js';
import { DEPLOYMENT_APP_ID, GENESIS_SEED } from '../../common/contantes.js';
import * as PromiseLib from "../../common/promise-libs.js"
import * as NonceStorage from '../../common/nonce-storage/index.js'

const {shuffle} = lodash;
const log = logger('muon:core:plugins:tss')

type KeyUsageTypeApp = {
  type: "app",
  seed: string,
}

type KeyUsageTypeNonce = {
  type: "nonce",
  message: string,
}

export type KeyGenOptions = {
  /**
   key ID
   */
  id?: string,
  /**
   partners to generate key between them
   */
  partners?: string[],
  /**
   * The partners subset who responsible to initialize and create the key.
   */
  dealers?: string[],
  /**
   Max number of partners to generate key.
   This option will ignore if exact list of partners specified
   */
  maxPartners?: number,
  /**
   Timeout for key generation process
   */
  timeout?: number,
  /**
   * If you set this value, the value will be shared between partners.
   */
  value?: string,

  lowerThanHalfN?: boolean,
  /**
   * Before generating a key, you need to specify what the key will be used for.

   */
  usage: KeyUsageTypeApp | KeyUsageTypeNonce,
}

export type NonceGenOptions = {
  /**
   nonce ID
   */
  id?: string,
  /**
   partners to generate key between them
   */
  partners?: string[],
  /** The count of nonce that will be generated. */
  n: number,
  /**
   Timeout for key generation process
   */
  timeout?: number,
}

const RemoteMethods = {
  KeyShareProof: "keyShareProof",
  InitFROST: "initFROST",
}

@remoteApp
class KeyManager extends CallablePlugin {
  /**
   map appId and seed to App TSS key
   example: appTss[appId][seed] = AppTssKey
   */
  appTss:{[index: string]: {[index: string]: AppTssKey}} = {}
  /**
   map appId and seed to App TSS key
   example: appTss[appId][seed] = AppTssKey
   */
  private appNonceBatches: MapOf<MapOf<AppNonceBatch>> = {};

  private mutex:Mutex;

  constructor(muon, configs) {
    super(muon, configs);
    this.mutex = new Mutex(undefined, {
      retryCount: 10000,
    });
  }

  async onStart() {
    await super.onStart();

    this.muon.on('app-context:delete', this.onAppContextDelete.bind(this))

    // @ts-ignore
    this.appManager.on('app-tss:delete', this.onAppTssDelete.bind(this))

    await this.nodeManager.waitToLoad()
    await this.appManager.waitToLoad();

    const mpcNetwork:MpcNetworkPlugin = this.muon.getPlugin('mpcnet');
    mpcNetwork.registerMpcInitHandler("DistributedKeyGeneration", this.dkgInitializeHandler.bind(this))
    mpcNetwork.registerMpcInitHandler("KeyRedistribution", this.keyRedistInitHandler.bind(this))
    mpcNetwork.registerMpcInitHandler("DistributedNonceGeneration", this.dngInitializeHandler.bind(this))

    this.muon.on("nonce-batch:gen", this.onNonceBatchGen.bind(this))
  }

  private get nodeManager(): NodeManagerPlugin {
    return this.muon.getPlugin('node-manager')
  }

  private get appManager(): AppManager {
    return this.muon.getPlugin('app-manager');
  }

  getAppTssKey(appId: string, seed: string): AppTssKey | null {
    if(!this.appTss[appId]) {
      this.appTss[appId] = {}
    }
    if(!this.appTss[appId][seed]) {
      const context = this.appManager.getAppContext(appId, seed)
      if (!context)
        return null

      const _key = this.appManager.getAppTssKey(appId, seed)
      if (!_key)
        return null

      let party = this.appManager.getAppParty(appId, seed)
      if(!party)
        return null;

      const key = AppTssKey.fromJson(
        party,
        this.appManager.currentNodeInfo!.id,
        {
          id: `app-${appId}`,
          share: _key.keyShare!,
          publicKey: _key.publicKey!.encoded!,
          partners: context.party.partners,
          polynomial: _key.polynomial,
        }
      )
      this.appTss[appId][seed] = key;
    }
    return this.appTss[appId][seed];
  }

  private async onAppContextDelete(data: {contexts: any[]}) {
    let {contexts} = data
    for(const context of contexts) {
      const {appId, seed} = context
      if(!!this.appTss[appId])
        delete this.appTss[appId][seed]
    }
  }

  async onAppTssDelete(appId, appTssConfig) {
    log(`AppTss delete from db %s %o`, appId, appTssConfig)
    const {seed} = appTssConfig
    if(!!this.appTss[appId])
      delete this.appTss[appId][seed]
  }

  async isNeedToCreateKey(){
    log("checking for deployment key creation ...")
    const deployers: string[] = this.nodeManager.filterNodes({isDeployer: true}).map(p => p.peerId)
    const onlineDeployers: string[] = await NetworkIpc.findNOnlinePeer(
      deployers,
      Math.ceil(this.netConfigs.tss.threshold*1.2),
      {timeout: 10000, return: 'peerId'}
    )
    if(onlineDeployers.length < this.netConfigs.tss.threshold) {
      log("no enough online deployers to check the key creation ...")
      return false;
    }

    const readyDeployers = await this.appManager.findNAvailablePartners({
      nodes: deployers,
      count: this.netConfigs.tss.threshold,
      partyInfo: {appId: DEPLOYMENT_APP_ID, seed: GENESIS_SEED},
      resolveAnyway: true,
    })
    log(`there is ${readyDeployers.length} deployers are ready.`)
    return readyDeployers.length < this.netConfigs.tss.threshold;
  }

  /**
   *
   * @param party
   * @param options
   * @param options.id: create key with specific id
   * @param options.maxPartners: create key that shared with at most `maxPartners` participants.
   * @returns {Promise<AppTssKey>}
   */
  async keyGen(partyInfo: PartyInfo, options: KeyGenOptions): Promise<AppTssKey> {
    let network: IMpcNetwork = this.muon.getPlugin('mpcnet');
    let {id, partners: oPartners, maxPartners, timeout=60000, value} = options;

    const party = this.appManager.getAppParty(partyInfo.appId, partyInfo.seed)

    if(!party)
      throw {message: `party not found`, partyInfo}

    let candidatePartners = party.partners;
    if(oPartners)
      candidatePartners = candidatePartners.filter(p => oPartners!.includes(p));

    let partners: MuonNodeInfo[] = this.nodeManager.filterNodes({
      list: candidatePartners,
    })

    if(maxPartners && maxPartners > 0) {
      /** exclude current node and add it later */
      partners = partners.filter(({wallet}) => (wallet !== process.env.SIGN_WALLET_ADDRESS))
      partners = [
        /** self */
        this.currentNodeInfo!,
        /** randomly select (maxPartners - 1) from others */
        ...shuffle(partners).slice(0, maxPartners - 1)
      ];
    }

    const keyId = id || uuid()

    log(`creating key with partners: %o`, partners.map(p => p.id))

    let keyGen: DistributedKeyGeneration, dKey: DistKey;
    do {
      keyGen = new DistributedKeyGeneration({
        /** MPC ID */
        id: uuid(),
        /**
         * starter of MPC
         * starter have higher priority than others when selecting MPC fully connected sub set.
         */
        starter: this.nodeManager.currentNodeInfo!.id,
        /** partners list */
        partners: partners.map(p => p.id),
        dealers: options.dealers || undefined,
        /** DKG threshold */
        t: party.t,
        /** DKG value to be shared between partners */
        value: options.value,
        /** extra values usable in DKG */
        extra: {
          mpcType: "DistributedKeyGeneration",
          usage: options.usage,
          partyInfo,
          keyId,
          lowerThanHalfN: options.lowerThanHalfN,
        }
      });
      dKey = await keyGen.runByNetwork(network, timeout)
    }
    while(options.lowerThanHalfN && dKey.publicKeyLargerThanHalfN());

    let key = new AppTssKey(party, keyGen.extraParams.keyId!, dKey)

    await SharedMemory.set(
      keyGen.extraParams.keyId,
      {
        usage: options.usage,
        partyInfo,
        key: key.toJson()
      },
      30*60*1000
    )
    return key;
  }

  async dkgInitializeHandler(constructData, network: MpcNetworkPlugin) {
    const dkg = new DistributedKeyGeneration(constructData)
    const {extra} = constructData

    dkg.runByNetwork(network)
      .then(async (dKey: DistKey) => {
        if(extra.lowerThanHalfN && dKey.publicKeyLargerThanHalfN())
          return;

        const partyInfo: PartyInfo = extra.partyInfo as PartyInfo
        const party = this.appManager.getAppParty(partyInfo.appId, partyInfo.seed);
        if(!party)
          throw `party[${extra.party}] not found`

        let key = new AppTssKey(party, extra.keyId, dKey)
        await SharedMemory.set(
          extra.keyId, {
            usage: extra.usage,
            partyInfo,
            key: key.toJson()
          },
          30*60*1000
        )
      })
      .catch(e => {
        // TODO
        log.error("KeyManager running mpc failed. %O", e)
      })

    return dkg;
  }

  async keyRedistInitHandler(constructData: KeyReDistOpts, network:MpcNetworkPlugin): Promise<KeyRedistribution> {
    const {extra} = constructData
    const {prevPartyInfo, partyInfo} = extra;

    const currentNode = this.nodeManager.currentNodeInfo!;
    if(!currentNode)
      throw `Current node not added to network`;

    const prevContext:AppContext|undefined = this.appManager.getSeedContext(prevPartyInfo.seed);
    const newContext:AppContext|undefined = this.appManager.getSeedContext(partyInfo.seed);

    if(!newContext)
      throw `missing new context info when trying to reshare`;
    if(lodash.difference(constructData.partners, newContext.party.partners).length > 0) {
      throw `An unknown partner in the reshare party`
    }
    if(!!this.appManager.getAppTssKey(newContext.appId, newContext.seed)) {
      throw `App tss key already reshared`;
    }

    if(prevContext) {
      if(newContext.previousSeed !== prevContext.seed)
        throw `The new context of reshare not related to the previous context.`;

      if(lodash.difference(constructData.dealers, prevContext.party.partners).length > 0) {
        throw `An unknown dealer in the reshare party`
      }
    }

    const key = this.appManager.getAppTssKey(prevPartyInfo.appId, prevPartyInfo.seed);
    const isDealer:boolean = !!key && constructData.dealers!.includes(currentNode.id);


    const _constructData: KeyReDistOpts = {...constructData}

    if(isDealer) {
      if(!key.polynomial)
        throw `The app's TSS key doesn't have any polynomial info to be reshared.`
      _constructData.publicKey = key.publicKey.encoded!;
      _constructData.previousPolynomial = key.polynomial;
      _constructData.value = key.keyShare
    }
    else {
      _constructData.dealers = constructData.dealers!.filter(id => id !== currentNode.id)
      _constructData.value = undefined;
    }

    const keyRedist = new KeyRedistribution(_constructData);

    keyRedist.runByNetwork(network)
      .then(async (dKey: DistKey) => {
        if(extra.lowerThanHalfN && dKey.publicKeyLargerThanHalfN())
          return;

        const partyInfo: PartyInfo = extra.partyInfo as PartyInfo
        const party = await this.appManager.getAppParty(partyInfo.appId, partyInfo.seed);
        if(!party)
          throw `party[${extra.party}] not found`

        let key = new AppTssKey(party, extra.keyId, dKey)
        await SharedMemory.set(
          extra.keyId,
          {
            usage: extra.usage,
            partyInfo,
            key: key.toJson()
          },
          30*60*1000
        );
      })
      .catch(e => {
        // TODO
        log.error("KeyManager running mpc failed. %O", e)
      })

    return keyRedist;
  }

  async redistributeKey(prevPartyInfo: PartyInfo, newPartyInfo: PartyInfo, options: KeyGenOptions): Promise<AppTssKey> {
    let network: IMpcNetwork = this.muon.getPlugin('mpcnet');
    let {id, timeout=60000} = options;

    const prevContext = this.appManager.getAppContext(prevPartyInfo.appId, prevPartyInfo.seed)
    if(!prevContext)
      throw {message: `reshare previous context not found`, prevPartyInfo}

    const newContext = this.appManager.getAppContext(newPartyInfo.appId, newPartyInfo.seed)
    if(!newContext)
      throw {message: `reshare onboarding context not found`, newPartyInfo};

    if(newContext.previousSeed !== prevContext.seed)
      throw `The new context of reshare not related to the previous context.`

    if(!this.appManager.appHasTssKey(prevPartyInfo.appId, prevPartyInfo.seed))
      throw {message: `the previous party doesn't have the tss key.`}

    let partners: MuonNodeInfo[] = this.nodeManager.filterNodes({
      list: newContext.party.partners,
    })

    const keyId = id || uuid()

    log(`creating key with partners: %o`, partners.map(p => p.id))

    const appKey = this.appManager.getAppTssKey(prevPartyInfo.appId, prevPartyInfo.seed);
    if(!appKey)
      throw `The app's TSS key was not found.`
    if(!appKey.polynomial)
      throw `The app's TSS key doesn't have any polynomial info to be reshared.`

    let keyRedist: KeyRedistribution, dKey: DistKey;
    do {
      keyRedist = new KeyRedistribution({
        /** MPC ID */
        id: uuid(),
        /**
         * starter of MPC
         * starter have higher priority than others when selecting MPC fully connected sub set.
         */
        starter: this.nodeManager.currentNodeInfo!.id,
        /** partners of the old party, that redistribute the key to the new partners. */
        dealers: lodash.intersection(prevContext.party.partners, newContext.party.partners),
        /** partners list */
        partners: partners.map(p => p.id),
        /** Previous party threshold */
        previousPolynomial: appKey.polynomial,
        /** DKG threshold */
        t: newContext.party.t,
        /** DKG value to be shared between partners */
        value: appKey.keyShare,
        /** public key of distributed key */
        publicKey: appKey.publicKey.encoded!,
        /** extra values usable in DKG */
        extra: {
          mpcType: "KeyRedistribution",
          usage: options.usage,
          prevPartyInfo: prevPartyInfo,
          partyInfo: newPartyInfo,
          keyId,
          lowerThanHalfN: options.lowerThanHalfN,
        }
      });
      dKey = await keyRedist.runByNetwork(network, timeout)
    }
    while(options.lowerThanHalfN && dKey.publicKeyLargerThanHalfN());

    let key = new AppTssKey(
      this.appManager.getAppParty(newPartyInfo.appId, newPartyInfo.seed)!,
      keyRedist.extraParams.keyId!,
      dKey
    )

    await SharedMemory.set(
      keyRedist.extraParams.keyId,
      {
        usage: options.usage,
        partyInfo: newPartyInfo,
        key: key.toJson()
      },
      30*60*1000
    );
    return key;
  }

  async nonceGen(partyInfo: PartyInfo, threshold: number, options: NonceGenOptions): Promise<AppNonceBatchJson> {
    let {id, n, timeout=60000} = options;

    const party = this.appManager.getAppParty(partyInfo.appId, partyInfo.seed)
    if(!party)
      throw {message: `party not found`, partyInfo};

    let candidatePartners = party.partners;
    if(options.partners)
      candidatePartners = candidatePartners.filter(p => options.partners!.includes(p));

    let partners: MuonNodeInfo[] = this.nodeManager.filterNodes({
      list: candidatePartners,
      excludeSelf: true,
    })

    const nonceId = id || uuid()

    const responses:(FrostCommitmentJson[]|null)[] = await PromiseLib.resolveN(
      Math.max(threshold, Math.ceil(partners.length * 0.8)),
      partners.map(({peerId, id}) => {
        return this.remoteCall(peerId, RemoteMethods.InitFROST, {partyInfo, nonceId, n})
        .catch(e => null);
      })
    )

    const qualifiedsResponse:MapOf<FrostCommitmentJson[]> = partners.reduce((obj, node, i) => {
      if(!!responses[i]) {
        obj[node.id] = responses[i];
      }
      return obj;
    }, {})

    const {nonces, commitments} = TssModule.frostInit(n);
    const frostNonces:FrostNonceJson[] = nonces.map(({d, e}, i) => {
      const init:MapOf<FrostCommitmentJson> = {
        [this.currentNodeInfo!.id]: {
          D: commitments[i].D.encode("hex", true),
          E: commitments[i].E.encode("hex", true),
        } 
      };
      return {
        d: d.toString(),
        e: e.toString(),
        commitments: Object.keys(qualifiedsResponse).reduce((obj: MapOf<FrostCommitmentJson>, id): MapOf<FrostCommitmentJson> => {
            obj[id] = { ... qualifiedsResponse[id][i] };
            return obj;
        }, init)
      }
    });

    const appNonceBatchJson: AppNonceBatchJson = {
      id: nonceId,
      partyInfo,
      nonceBatch: {
        n,
        partners: [this.currentNodeInfo!.id, ...Object.keys(qualifiedsResponse)],
        nonces: frostNonces
      }
    }

    // CoreIpc.fireEvent({type: "nonce-batch:gen", data: appNonceBatchJson})
    await NonceStorage.put({
      seed: partyInfo.seed, 
      owner: this.currentNodeInfo!.id, 
      appNonceBatch: appNonceBatchJson
    });

    return appNonceBatchJson;
  }

  async nonceGenOld(partyInfo: PartyInfo, options: NonceGenOptions): Promise<AppNonceBatch> {
    let network: IMpcNetwork = this.muon.getPlugin('mpcnet');
    let {id, partners: oPartners, n, timeout=60000} = options;

    const party = this.appManager.getAppParty(partyInfo.appId, partyInfo.seed)

    if(!party)
      throw {message: `party not found`, partyInfo};

    let candidatePartners = party.partners;
    if(oPartners)
      candidatePartners = candidatePartners.filter(p => oPartners!.includes(p));

    let partners: MuonNodeInfo[] = this.nodeManager.filterNodes({
      list: candidatePartners,
    })

    const nonceId = id || uuid()
    
    let nonceGen:DistributedNonceGeneration, nonceBatch: NonceBatch; 
    nonceGen = new DistributedNonceGeneration({
      /** MPC ID */
      id: uuid(),
      /**
       * starter of MPC
       * starter have higher priority than others when selecting MPC fully connected sub set.
       */
      starter: this.nodeManager.currentNodeInfo!.id,
      /** partners list */
      partners: partners.map(p => p.id),
      /** The count of nonce that will be generated. */
      n: n ?? 1000,
      /** extra values usable in DKG */
      extra: {
        mpcType: "DistributedNonceGeneration" as MpcType,
        partyInfo,
        nonceId,
      }
    })
    nonceBatch = await nonceGen.runByNetwork(network, timeout)
    const appNonceBatch = new AppNonceBatch(partyInfo, nonceId, nonceBatch);

    // TODO: store nonceBatch to be used in all cluster.

    CoreIpc.fireEvent({type: "nonce-batch:gen", data: appNonceBatch.toJson()})

    return appNonceBatch;
  }

  async dngInitializeHandler(constructData, network: MpcNetworkPlugin): Promise<DistributedNonceGeneration> {
    const dng = new DistributedNonceGeneration(constructData)
    const {extra} = constructData

    dng.runByNetwork(network)
      .then(async (nonceBatch: NonceBatch) => {
        const partyInfo: PartyInfo = extra.partyInfo as PartyInfo
        const party = this.appManager.getAppParty(partyInfo.appId, partyInfo.seed);
        if(!party)
          throw `party[${extra.party}] not found`

        // TODO: store nonceBatch to be used in all cluster.
        const appNonceBatch = new AppNonceBatch(partyInfo,  extra.nonceId, nonceBatch);

        //CoreIpc.fireEvent({type: "nonce-batch:gen", data: appNonceBatch.toJson()})
        await NonceStorage.put({
          seed: partyInfo.seed, 
          owner: constructData.starter, 
          appNonceBatch: appNonceBatch.toJson()
        });

        // let key = new AppTssKey(party, extra.keyId, dKey)
        // await SharedMemory.set(
        //   extra.keyId, {
        //     usage: extra.usage,
        //     partyInfo,
        //     key: key.toJson()
        //   },
        //   30*60*1000
        // )
      })
      .catch(e => {
        // TODO
        log.error("KeyManager running mpc failed. %O", e)
      })

    return dng;
  }

  async initFrostNonce(reqId: string): Promise<FrostCommitment> {
    const d = TssModule.curve.genKeyPair(), e = TssModule.curve.genKeyPair()
    await SharedMemory.set(
      `frost-single-nonce-${reqId}`, 
      {
        d: bn2hex(d.getPrivate()),
        e: bn2hex(e.getPrivate())
      },
      5*60e3
    )
    return {
      D: d.getPublic(),
      E: e.getPublic(),
    }
  }

  async getFrostNonce(reqId: string): Promise<FrostNonce> {
    let {d, e} = await SharedMemory.waitAndGet(`frost-single-nonce-${reqId}`, 5e3)
    d = TssModule.keyFromPrivate(d);
    e = TssModule.keyFromPrivate(e);
    return {
      d: d.getPrivate(),
      e: e.getPrivate(),
      commitments: {
        [this.currentNodeInfo!.id]: {
          D: d.getPublic(),
          E: e.getPublic()
        }
      }
    }
  }

  async onNonceBatchGen(appNonceBatchJson: AppNonceBatchJson) {
    try {
      const appNonceBatch: AppNonceBatch = AppNonceBatch.fromJson(appNonceBatchJson);
      const {partyInfo} = appNonceBatchJson;
      if(this.appNonceBatches[partyInfo.appId] === undefined) {
        this.appNonceBatches[partyInfo.appId] = {};
      }
      this.appNonceBatches[partyInfo.appId][partyInfo.seed] = appNonceBatch;

      await SharedMemory.set(
        appNonceBatchJson.id,
        {
          partyInfo,
          index: 0
        },
        /** clear after 7 days */
        7*24*60*60*1000
      );
    }
    catch(e) {
    }
  }

  async getSharedKey(id: string, timeout:number=5000, expectedUsage:KeyUsageTypeApp|KeyUsageTypeNonce): Promise<AppTssKey> {
    let {partyInfo, key, usage} = await SharedMemory.waitAndGet(id, timeout)
    if(usage.type !== expectedUsage.type) {
      throw `tss key usage mismatch.`
    }
    else {
      switch (usage.type) {
        case "app": {
          // @ts-ignore
          if(!usage.seed || usage.seed !== expectedUsage.seed)
            throw `tss key usage mismatch.`
          break;
        }
        case "nonce": {
          // @ts-ignore
          if(!usage.message || usage.message !== expectedUsage.message)
            throw `tss key usage mismatch.`
          break;
        }
        default:
          throw `incorrect tss key usage`
      }
    }
    let party = this.appManager.getAppParty(partyInfo.appId, partyInfo.seed);
    if(!party)
      throw `party [${key.party}] not found`

    return AppTssKey.fromJson(party, this.currentNodeInfo!.id, key)
  }

  hasNonceBatch(appId: string, seed: string): boolean {
    if(!this.appNonceBatches[appId])
      return false;
    return this.appNonceBatches[appId][seed] !== undefined;
  }

  getAppNonceBatch(appId: string, seed: string): AppNonceBatch|undefined {
    if(!this.appNonceBatches[appId])
      return undefined;
    return this.appNonceBatches[appId][seed];
  }

  // async takeNonceIndex(seed: string, timeout: number=5000): Promise<number> {
  //   return NonceStorage.pickIndex(seed, this.currentNodeInfo!.id, timeout);
  //   // const lock = await this.mutex.lock(id);
  //   // try {
  //   //   const {partyInfo, index} = await SharedMemory.waitAndGet(id, timeout);
  //   //   await SharedMemory.set(
  //   //     id,
  //   //     {
  //   //       partyInfo,
  //   //       index: index+1
  //   //     },
  //   //     /** clear after 7 days */
  //   //     7*24*60*60*1000
  //   //   );
  //   //   return index;
  //   // }
  //   // finally {
  //   //   await lock.release();
  //   // }
  // }

  /**
   * Ask all the key partners who has the key share.
   *
   * @param holders {string[]} - key partners id list
   * @param keyId {string} - the unique id of the key
   * @param Fx {string[]} - public polynomial of the key
   */
  async getKeyShareProofs(seed: string, partners: string[], keyId: string, Fx: PublicKey[]) {
    let nodeInfos = this.nodeManager.filterNodes({list: partners});
    /** nodes must sign hash of publicKey */
    const keyPublicHash = muonSha3(Fx[0].encode("hex", true));

    const usage:KeyUsageTypeApp = {type: "app", seed}
    const signatures = await Promise.all(
      nodeInfos.map(n => {
        const isCurrentNode = n.id === this.nodeManager.currentNodeInfo!.id;
        return (
          isCurrentNode
          ?
          this.__keyShareProof({keyId, usage}, this.nodeManager.currentNodeInfo!)
          :
          this.remoteCall(
            n.peerId,
            RemoteMethods.KeyShareProof,
            {keyId, usage},
            {timeout: 20000},
          )
        )
          .then(signature => {
            const nodesPublicKey = TssModule.calcPolyPoint(n.id, Fx);
            const nodesAddress = TssModule.pub2addr(nodesPublicKey);
            if (crypto.recover(keyPublicHash, signature) !== nodesAddress) {
              throw `verification failed`
            }
            return signature
          })
          .catch(e => null)
      })
    )

    return nodeInfos.reduce((obj, n, i) => {
      if(!!signatures[i])
        obj[n.id]=signatures[i]
      return obj;
    }, {});
  }

  /**==================================
   *
   *           Remote Methods
   *
   *===================================*/

  @remoteMethod(RemoteMethods.KeyShareProof)
  async __keyShareProof(data: {keyId: string, usage: KeyUsageTypeApp|KeyUsageTypeNonce}, callerInfo:MuonNodeInfo): Promise<string> {
    const key = await this.getSharedKey(data.keyId, 15e3, data.usage);
    const keyPublicHash = muonSha3(key.publicKey.encode('hex', true));
    return crypto.signWithPrivateKey(keyPublicHash, bn2hex(key.share));
  }

  @remoteMethod(RemoteMethods.InitFROST)
  async __initFROST(data: {partyInfo: PartyInfo, n: number, nonceId: string}, callerInfo: MuonNodeInfo): 
  Promise<(FrostNonceJson|FrostCommitmentJson)[]> {
    const {partyInfo: {appId, seed}, n, nonceId} = data;
    const appParty = this.appManager.getAppParty(appId, seed);
    if(!appParty) {
      throw `Missing app party`
    }
    const currentNode:MuonNodeInfo = this.currentNodeInfo!;
    if(callerInfo.id === currentNode.id) {
      throw `InitFrost not allowed to call by self`
    }

    const {nonces, commitments} = TssModule.frostInit(n);
    const appNonceBatchJson: AppNonceBatchJson = new AppNonceBatch(
      {appId, seed}, 
      nonceId, 
      new NonceBatch(
        n, appParty.partners, 
        nonces.map(({d, e}, i) => ({d, e, commitments: {}})))
    ).toJson();
    
    // CoreIpc.fireEvent({type: "nonce-batch:gen", data: appNonceBatchJson})
    await NonceStorage.put({
      seed, 
      owner: callerInfo.id, 
      appNonceBatch: appNonceBatchJson
    });
    return commitments.map(({D, E}) => ({
      D: D.encode("hex", true),
      E: E.encode("hex", true),
    }))
  }
}

export default KeyManager;
