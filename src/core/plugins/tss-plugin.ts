import CallablePlugin from './base/callable-plugin.js'
import AppTssKey, {AppTssKeyJson} from "../../utils/tss/app-tss-key.js";
import lodash from 'lodash'
import * as tssModule from '../../utils/tss/index.js'
import Web3 from 'web3'
import {timeout, stackTrace, uuid, pub2json} from '../../utils/helpers.js'
import {remoteApp, remoteMethod} from './base/app-decorators.js'
import NodeManagerPlugin from "./node-manager.js";
import * as SharedMemory from '../../common/shared-memory/index.js'
import * as NetworkIpc from '../../network/ipc.js'
import * as CoreIpc from '../ipc.js'
import {AppContext, MuonNodeInfo, NetConfigs, PartyInfo} from "../../common/types";
import AppManager from "./app-manager.js";
import TssParty from "../../utils/tss/party.js";
import {IMpcNetwork, MapOf} from "../../common/mpc/types";
import {DistributedKeyGeneration} from "../../common/mpc/dkg.js";
import {DistKey} from "../../common/mpc/dist-key.js";
import {logger} from '@libp2p/logger'
import {bn2hex} from "../../utils/tss/utils.js";
import {useOneTime} from "../../utils/tss/use-one-time.js";

const {shuffle} = lodash;
const {utils:{toBN}} = Web3;
const log = logger('muon:core:plugins:tss')

const LEADER_ID = process.env.LEADER_ID || '1';

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
}

const RemoteMethods = {
  recoverMyKey: 'recoverMyKey',
  storeDeploymentTssKey: 'storeDeploymentTssKey',
}

@remoteApp
class TssPlugin extends CallablePlugin {
  isReady = false
  parties:{[index: string]: TssParty} = {}
  tssKey: AppTssKey | null = null;
  tssParty: TssParty | null = null;
  /**
   map appId and seed to App TSS key
   example: appTss[appId][seed] = AppTssKey
   */
  appTss:{[index: string]: {[index: string]: AppTssKey}} = {}

  async onStart() {
    super.onStart();

    this.muon.on("contract:node:add", this.onNodeAdd.bind(this));
    this.muon.on("contract:node:edit", this.onNodeEdit.bind(this));
    this.muon.on("contract:node:delete", this.onNodeDelete.bind(this));

    this.muon.on('app-context:delete', this.onAppContextDelete.bind(this))
    this.muon.on('deployment-tss-key:generate', this.onDeploymentTssKeyGenerate.bind(this));

    // @ts-ignore
    this.appManager.on('app-tss:delete', this.onAppTssDelete.bind(this))

    await this.nodeManager.waitToLoad()
    await this.appManager.waitToLoad();
    this.loadDeploymentTss();

  }

  async onNodeAdd(nodeInfo: MuonNodeInfo) {
    log(`node add %o`, nodeInfo)

    //await timeout(5000);

    const selfInfo = this.nodeManager.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!);
    if(!selfInfo) {
      log(`current node not in the network yet.`)
      return;
    }

    if(selfInfo.id === nodeInfo.id){
      log(`current node added to the network and loading tss info.`)
      this.loadDeploymentTss()
    }
    else {
      if(nodeInfo.isDeployer) {
        log(`adding the new node [%s] into the tss party.`, nodeInfo.id);
        this.tssParty!.addPartner(nodeInfo.id)
      }
    }
  }

  async onNodeEdit(data: {nodeInfo: MuonNodeInfo, oldNodeInfo: MuonNodeInfo}) {
    const {nodeInfo, oldNodeInfo} = data
    log(`node edit %o`, {nodeInfo, oldNodeInfo})

    /**
     * if the current node is edited, its needs some time to tssParty be updated
     */
    log("onNodeEdit timeout(5000)")
    await timeout(5000);

    if(nodeInfo.isDeployer !== oldNodeInfo.isDeployer) {
      const selfInfo = this.nodeManager.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)
      if(!selfInfo)
        return ;

      if(nodeInfo.isDeployer) {
        if(nodeInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
          await this.loadDeploymentTss()
        }
        else {
          if(nodeInfo.isDeployer)
            this.tssParty!.addPartner(nodeInfo.id)
        }
      }
      else {
        if(nodeInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
          this.isReady = false
          this.tssKey = null
          if(this.tssParty) {
            const p = this.tssParty
            delete this.parties[p.id];
          }
        }
        else {
          if(this.tssParty)
            this.tssParty.deletePartner(nodeInfo.id);
        }
      }
    }
  }

  onNodeDelete(nodeInfo: MuonNodeInfo) {
    log(`Node delete %o`, nodeInfo)
    Object.keys(this.parties).forEach(partyId => {
      const party = this.parties[partyId]
      party.deletePartner(nodeInfo.id);
    })
  }

  private get nodeManager(): NodeManagerPlugin {
    return this.muon.getPlugin('node-manager')
  }

  private get appManager(): AppManager {
    return this.muon.getPlugin('app-manager');
  }

  getDeploymentTssConfig(){
    let {tss: tssConfig} = this.muon.configs;
    if(!tssConfig)
      return null;

    if(!tssConfig.party.t) {
      return null;
    }

    return tssConfig;
  }

  async loadDeploymentTss() {

    const currentNodeInfo = this.nodeManager.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)

    /** current node not in the network */
    if(!currentNodeInfo || !currentNodeInfo.isDeployer) {
      return;
    }
    log(`loading deployment tss info ...`)

    //TODO: handle {isValid: false};

    this.tssParty = this.getAppParty("1", "1")!;
    log(`tss party loaded.`)

    // @ts-ignore
    this.emit('party-load');

    // this.tryToFindOthers(3);

    // validate tssConfig
    let tssConfig = this.getDeploymentTssConfig();

    if(tssConfig && tssConfig.party.t == this.netConfigs.tss.threshold){
      let key = AppTssKey.fromJson(
        this.tssParty,
        this.nodeManager.currentNodeInfo!.id,
        {
          id: tssConfig.key.id,
          share: tssConfig.key.share,
          publicKey: tssConfig.key.publicKey,
          partners: this.tssParty.partners,
          polynomial: tssConfig.key.polynomial,
        }
      );
      await useOneTime("key", key.publicKey!.encode('hex', true), `app-1-tss`)
      this.tssKey = key;
      this.isReady = true
      log('deployment tss is ready.');
    }
    else{
      /**
       A core process is responsible for creating or recovering the Tss Key.
       However, sometimes (when cluster mode is enabled) there are multiple core processes running simultaneously, which can cause problems.
       Therefore, only one core process should be allowed to handle the Tss Key at a time.
       */
      let permitted = await NetworkIpc.askClusterPermission('deployment-tss-key-creation', 20000)
      if(!permitted)
        return;

      log('waiting for the threshold number of deployers to get online ...')
      let onlineDeployers: string[];
      while (true) {
        const deployers: string[] = this.nodeManager.filterNodes({isDeployer: true}).map(p => p.peerId)
        onlineDeployers = await NetworkIpc.findNOnlinePeer(
          deployers,
          Math.ceil(this.tssParty.t*1.3),
          {timeout: 5000}
        );

        if(onlineDeployers.length >= this.netConfigs.tss.threshold) {
          log(`${onlineDeployers.length} number of deployers are now online.`)
          break;
        }

        /** wait 5 seconds and retry again */
        log("online deployers %o", onlineDeployers)
        log(`waiting: only ${onlineDeployers.length} number of deployers are online.`)
        await timeout(5000);
      }

      const currentNodeInfo = this.nodeManager.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)
      if (currentNodeInfo && currentNodeInfo.id == LEADER_ID && await this.isNeedToCreateKey()) {
        log(`Got permission to create tss key`);
        let key: AppTssKey = await this.tryToCreateDeploymentTssKey();
        log(`TSS key generated with ${key.partners.length} partners`);
      }
      else{
        log(`trying to recover deployment tss key... timeout(6000)`)

        while (!this.isReady) {
          log("waiting for tss, timeout(5000)");
          await timeout(5000);
          const context: AppContext = this.appManager.getAppContext("1", "1")
          const readyPartnersId = await this.appManager.findNAvailablePartners(
            context.party.partners,
            Math.ceil(context.party.t * 1.2),
            {appId: "1", seed: "1", excludeSelf: true},
          )

          if(readyPartnersId.length >= context.party.t){
            log(`deployment tss is ready.`);
            try {
              const readyPartners = this.nodeManager.filterNodes({list: readyPartnersId});
              await this.tryToRecoverDeploymentTssKey(readyPartners!);
            }
            catch (e) {
              log(`Error when trying to recover tss key`);
            }
          }
          else {
            log(`deployment tss is not ready.`);
          }
        }
      }
    }
  }

  getAppTssKey(appId: string, seed: string): AppTssKey | null {
    if(appId == '1') {
      return this.tssKey;
    }
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

      let party = this.getAppParty(appId, seed)
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
      const partyId = this.getAppPartyId(context);
      delete this.parties[partyId]
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

  getAppPartyId(context, isForReshare:boolean=false) {
    const {seed, previousSeed} = context
    return isForReshare ? `app-${seed}-${previousSeed}-party` : `app-${seed}-party`;
  }

  getAppParty(appId: string, seed: string, isForReshare:boolean=false): TssParty|undefined {
    const _context:AppContext = this.appManager.getAppContext(appId, seed)
    /** is app deployed? return if not. */
    if(!_context)
      return undefined;

    const partyId = this.getAppPartyId(_context, isForReshare);

    if(!this.parties[partyId]) {
      let partners = _context.party.partners
      if(isForReshare){
        const previousContext: AppContext = this.appManager.getAppContext(appId, _context.previousSeed)
        if(!previousContext)
          return undefined;
        partners = lodash.uniq([
          ..._context.party.partners,
          ...previousContext.party.partners
        ])
      }
      this.loadParty({
        id: partyId,
        t: _context.party.t,
        max: _context.party.max,
        partners
      })
    }
    return this.parties[partyId];
  }

  async getAppPartyAsync(appId: string, seed: string, isForReshare:boolean=false) {
    const _context:AppContext|undefined = await this.appManager.getAppContextAsync(appId, seed, true)
    /** is app deployed? return if not. */
    if(!_context)
      return undefined;

    const partyId = this.getAppPartyId(_context, isForReshare);

    if(!this.parties[partyId]) {
      let partners = _context.party.partners
      if(isForReshare){
        const previousContext: AppContext|undefined = await this.appManager.getAppContextAsync(appId, _context.previousSeed, true)
        if(!previousContext)
          return undefined;
        partners = lodash.uniq([
          ..._context.party.partners,
          ...previousContext.party.partners
        ])
      }
      this.loadParty({
        id: partyId,
        t: _context.party.t,
        max: _context.party.max,
        partners
      })
    }
    return this.parties[partyId];
  }

  async isNeedToCreateKey(){
    log("checking for deployment key creation ...")
    const deployers: string[] = this.nodeManager.filterNodes({isDeployer: true}).map(p => p.peerId)
    const onlineDeployers: string[] = await NetworkIpc.findNOnlinePeer(
      deployers,
      Math.ceil(this.tssParty!.t*1.2),
      {timeout: 10000, return: 'peerId'}
    )
    if(onlineDeployers.length < this.tssParty!.t) {
      log("no enough online deployers to check the key creation ...")
      return false;
    }

    const readyDeployers = await this.appManager.findNAvailablePartners(
      deployers,
      this.netConfigs.tss.threshold,
      {appId: "1", seed: "1"}
    )
    log(`there is ${readyDeployers.length} deployers are ready.`)
    return readyDeployers.length < this.netConfigs.tss.threshold;
  }

  saveTssConfig(party, key) {
    let tssConfig = {
      party: {
        id: party.id,
        t: party.t,
        max: party.max
      },
      key: {
        id: key.id,
        // shared part of tss key
        share: `0x${key.share.toString(16)}`,
        // public of tss key
        publicKey: `${key.publicKey.encode('hex', true)}`,
        // distributed key address
        address: tssModule.pub2addr(key.publicKey),
        // tss key's polynomial info
        ...(!!key.polynomial ? {polynomial: key.toJson().polynomial} : {}),
      }
    }

    this.muon.backupConfigFile('tss.conf.json');
    // console.log('save config temporarily disabled for test.');
    this.muon.saveConfig(tssConfig, 'tss.conf.json')
  }

  loadParty(party) {
    // console.log(`TssPlugin.loadParty`, party)
    if(party.partners.lengh > 0 && typeof party.partners[0] !== "string") {
      console.log("TssPlugin.loadParty.partners most be string array", party.partners)
      console.log(stackTrace())
    }
    try {
      let p = TssParty.load(party)
      this.parties[p.id] = p
    }
    catch (e) {
      console.log('loading party: ', party);
      console.log('partners info: ', party);
      console.log(`TssPlugin.loadParty ERROR:`, e)
    }
  }

  async onDeploymentTssKeyGenerate(tssKey) {
    if(!this.isReady) {
      this.tssKey = AppTssKey.fromJson(this.tssParty!, this.nodeManager.currentNodeInfo!.id, tssKey);
      this.isReady = true;
    }
  }

  private async tryToRecoverDeploymentTssKey(readyPartners: MuonNodeInfo[]){
    log(`generating nonce for recovering deployment tss key`)

    let nonce = await this.keyGen({appId: "1", seed: "1"}, {
      id: `recovery-${uuid()}`,
      partners: [
        this.nodeManager.currentNodeInfo!.id,
        ...readyPartners.map(p => p.id),
      ]
    });
    log(`nonce generated for recovering deployment tss key`)

    const noncePartners = this.nodeManager.filterNodes({
      list: nonce.partners,
      excludeSelf: true,
    })
    await useOneTime("key", nonce.publicKey!.encode('hex', true), `app-1-tss-recovery`, 3600)
    let tssKey = await this.recoverAppTssKey('1', '1', noncePartners, nonce);

    this.tssKey = tssKey
    this.isReady = true;
    await useOneTime("key", tssKey.publicKey!.encode('hex', true), `app-1-tss`)
    this.saveTssConfig(this.tssParty, tssKey)
    CoreIpc.fireEvent({type: "deployment-tss-key:generate", data: tssKey.toJson()});
    log(`pid:${process.pid} tss key recovered`);
    return true;
  }

  /**
   * Recover share of App's TSS key.
   * In general, only party partners are allowed to recover their own key share, but when the party rotates, a new party is allowed too.
   *
   * @param appId {string} - Which app is needs to be recovered.
   * @param seed {string} - Which context of app needs to be recovered.
   * @param partners {string[]} - List of partners that helps to the key be recovered.
   * @param nonce {string} - ID of nonce that will be used for recovery.
   * @param newSeed {string} - Deployment seed of App's new context. A new context will be generated by deployers when the old context is about to expire..
   */
  async recoverAppTssKey(appId: string, seed: string, partners: MuonNodeInfo[], nonce: AppTssKey): Promise<AppTssKey> {
    let appParty = this.getAppParty(appId, seed);

    if(!appParty)
      throw `AppParty does not exist for recovering the key.`

    if(partners.length < appParty.t)
      throw {message: "No enough online partners to recover the key."};

    await useOneTime("key", nonce.publicKey!.encode('hex', true), `app-${appId}-tss-recovery`, 3600)

    let keyResults = await Promise.all(
      partners.map(p => {
          return this.remoteCall(
            // online partners
            p.peerId,
            RemoteMethods.recoverMyKey,
            {nonce: nonce.id, appId, seed},
            {taskId: nonce.id}
          ).catch(e => {
            log.error(`getting key recovery share error:`, e)
            return null
          })
        }
      )
    )

    let shares = partners
      .map((p, j) => {
          if (!keyResults[j])
            return null
          return {
            i: p.id,
            key: tssModule.keyFromPrivate(keyResults[j].recoveryShare)
          }
        }
      )
      .filter(s => !!s)

    if (shares.length < appParty!.t)
      throw `Need's of ${appParty!.t} result to recover the Key, but received ${shares.length} result.`

    let myIndex = this.currentNodeInfo!.id;
    // @ts-ignore
    let reconstructed = tssModule.reconstructKey(shares, appParty.t, myIndex)
    let myKey = reconstructed.sub(nonce.share!).umod(tssModule.curve.n!)

    return AppTssKey.fromJson(
      appParty,
      this.currentNodeInfo!.id,
      {
        id: keyResults[0].id,
        share: bn2hex(myKey),
        publicKey: keyResults[0].publicKey,
        partners: appParty.partners,
        polynomial: keyResults[0].polynomial,
      }
    )
  }

  private appTssKeyRecoveryCheckTime: MapOf<number> = {};

  /**
   * Find a list of partners who have the app key and attempt to recover the app key.
   * @param appId {string} - App ID
   * @param seed {string} - Apps context identifier.
   * @param forceRetry {boolean} - By default, this method will cache the result to prevent simultaneous search.
   * Sometimes it is necessary to retry and ignore the cache.
   * @return {boolean} - Is App's tss key recovered successfully or not.
   */
  async checkAppTssKeyRecovery(appId: string, seed: string, forceRetry:boolean=false): Promise<boolean> {
    const lastCallTime = this.appTssKeyRecoveryCheckTime[`${appId}-${seed}`] ?? 0;
    if(!forceRetry && lastCallTime + 5*60e3 > Date.now())
      return false;

    log(`checking to recover app[${appId}] tss key`)
    this.appTssKeyRecoveryCheckTime[`${appId}-${seed}`] = Date.now();
    try {
      let context: AppContext = this.appManager.getAppContext(appId, seed);
      if(!context || !context.keyGenRequest) {
        const contexts: AppContext[] = await this.appManager.queryAndLoadAppContext(appId);
        context = contexts.find(ctx => ctx.seed === seed)!

        if(!context || !context.keyGenRequest)
          throw `app tss is not ready yet (missing context).`
      }
      const readyPartnersId = await this.appManager.findNAvailablePartners(
        context.party.partners,
        Math.ceil(context.party.t * 1.2),
        {appId, seed, excludeSelf: true}
      )
      log(`this nodes are ready to recover App's key: ${readyPartnersId}`)
      const readyPartners: MuonNodeInfo[] = this.nodeManager.filterNodes({list: readyPartnersId});

      if(readyPartners.length >= context.party.t) {
        log(`app[${appId}] tss is ready and can be recovered by partners `, readyPartners!.map(({id}) => id));
        log(`generating nonce for recovering app[${appId}] tss key`)
        let nonce = await this.keyGen(
          {appId, seed},
          {
            id: `recovery-${uuid()}`,
            partners: [
              this.nodeManager.currentNodeInfo!.id,
              ...readyPartners.map(p => p.id),
            ]
          }
        );
        log(`nonce generated for recovering app[${appId}] tss key`)
        //
        const noncePartners = this.nodeManager.filterNodes({
          list: nonce.partners,
          excludeSelf: true,
        })
        let key = await this.recoverAppTssKey(appId, seed, noncePartners, nonce);
        if(key) {
          log(`app tss key recovered`)
          const netConfigs = this.muon.configs.net
          let expiration: number|undefined;
          let polynomial: any;
          if(context.deploymentRequest && context.ttl) {
            expiration = context.deploymentRequest.data.timestamp + context.ttl + netConfigs.tss.pendingPeriod
          }
          if(context.keyGenRequest) {
            polynomial = context.keyGenRequest.data.result.polynomial
            if(context.keyGenRequest.data.result.oldPolynomial) {
              polynomial = this.appManager.mergeResharePolynomial(
                context.keyGenRequest.data.result.oldPolynomial,
                context.keyGenRequest.data.result.polynomial,
                seed)
            }
          }
          await this.appManager.saveAppTssConfig({
            appId: appId,
            seed,
            keyGenRequest: context.keyGenRequest,
            publicKey: pub2json(key.publicKey!),
            keyShare: bn2hex(key.share!),
            polynomial,
            expiration
          })

          return true;
        }
      }
      else {
        log(`app[${appId}] tss is not ready yet`)
        throw `app tss is not ready yet (no enough ready partners)`;
      }
    }
    catch (e) {
      log(`recovering app[${appId}] tss key failed %O`, e);
      throw e;
    }
    return false;
  }

  async tryToCreateDeploymentTssKey(): Promise<AppTssKey> {
    const deployers: string[] = this.nodeManager.filterNodes({isDeployer: true}).map(p => p.peerId)
    while (!this.isReady) {
      log('deployment tss is not ready. timeout(5000)')
      await timeout(5000);
      try {
        const onlineDeployers: string[] = await NetworkIpc.findNOnlinePeer(
          deployers,
          Math.ceil(this.tssParty!.t*1.2),
          {timeout: 10000}
        )
        if(onlineDeployers.length < this.tssParty!.t) {
          log(`Its need ${this.tssParty!.t} deployer to create deployment tss but only ${onlineDeployers.length} are available`)
          continue;
        }
        log(`Deployers %o are available to create deployment tss`, onlineDeployers)
        let key: AppTssKey = await this.keyGen(
          {appId: "1", seed: "1"},
          {
            partners: onlineDeployers,
            lowerThanHalfN: true
          }
        )

        let keyPartners = this.nodeManager.filterNodes({list: key.partners, excludeSelf: true})
        let callResult = await Promise.all(keyPartners.map(({wallet, peerId}) => {
          return this.remoteCall(
            peerId,
            RemoteMethods.storeDeploymentTssKey,
            {
              party: this.tssParty!.id,
              key: key.id,
            },
            {timeout: 120e3}
            // {taskId: `keygen-${key.id}`}
          ).catch(e=>{
            console.log("RemoteCall.storeDeploymentTssKey", e);
            return false
          });
        }))
        if (callResult.filter(r => r === true).length+1 < this.netConfigs.tss.threshold)
          throw `Tss creation failed.`
        await useOneTime("key", key.publicKey!.encode('hex', true), `app-1-tss`)
        this.saveTssConfig(this.tssParty, key)

        this.tssKey = key;
        this.isReady = true;
        CoreIpc.fireEvent({type: "deployment-tss-key:generate", data: key.toJson()});
        log('tss ready.')
      } catch (e) {
        log('error when trying to create tss key %o %o', e, e.stack);
      }
    }

    return this.tssKey!
  }

  /**
   *
   * @param party
   * @param options
   * @param options.id: create key with specific id
   * @param options.maxPartners: create key that shared with at most `maxPartners` participants.
   * @returns {Promise<AppTssKey>}
   */
  async keyGen(partyInfo: PartyInfo, options: KeyGenOptions={}): Promise<AppTssKey> {
    let network: IMpcNetwork = this.muon.getPlugin('mpcnet');
    let {id, partners: oPartners, maxPartners, timeout=60000, value} = options;

    const party = this.getAppParty(partyInfo.appId, partyInfo.seed, partyInfo.isForReshare)

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
      // console.log(partners)
      // partners = partners.slice(0, maxPartners);
    }

    const keyId = id || uuid()

    log(`creating key with partners: %o`, partners.map(p => p.id))

    let keyGen: DistributedKeyGeneration, dKey: DistKey;
    do {
      keyGen = new DistributedKeyGeneration(
        /** MPC ID */
        uuid(),
        /**
         * starter of MPC
         * starter have higher priority than others when selecting MPC fully connected sub set.
         */
        this.nodeManager.currentNodeInfo!.id,
        /** partners list */
        partners.map(p => p.id),
        /** DKG threshold */
        party.t,
        /** DKG value to be shared between partners */
        options.value,
        /** extra values usable in DKG */
        {
          partyInfo,
          keyId,
          lowerThanHalfN: options.lowerThanHalfN,
        }
      );
      dKey = await keyGen.runByNetwork(network, timeout)
    }
    while(options.lowerThanHalfN && dKey.publicKeyLargerThanHalfN());

    let key = new AppTssKey(party, keyGen.extraParams.keyId!, dKey)

    await SharedMemory.set(keyGen.extraParams.keyId, {partyInfo, key: key.toJson()}, 30*60*1000)
    return key;
  }

  async getSharedKey(id: string, timeout:number=5000): Promise<AppTssKey> {
    let {partyInfo, key} = await SharedMemory.waitAndGet(id, timeout)
    let party = this.getAppParty(partyInfo.appId, partyInfo.seed, partyInfo.isForReshare);
    if(!party)
      throw `party [${key.party}] not found`

    return AppTssKey.fromJson(party, this.currentNodeInfo!.id, key)
  }

  getParty(id) {
    return this.parties[id];
  }

  /**==================================
   *
   *           Remote Methods
   *
   *===================================*/

  /**
   * Each node can request other nodes to recover its own key.
   * This process will be done after creating a AppTssKey as a nonce.
   *
   * @param data: Key recovery info
   * @param data.nonce: Nonce id that crated for key recovery
   *
   * @param callerInfo: caller node information
   * @param callerInfo.wallet: collateral wallet of caller node
   * @param callerInfo.peerId: PeerID of caller node
   * @returns {Promise<{address: string, recoveryShare: string, id: *, publicKey: string}|null>}
   * @private
   */
  @remoteMethod(RemoteMethods.recoverMyKey)
  async __recoverMyKey(data: {nonce: string, appId: string, seed: string}, callerInfo: MuonNodeInfo) {
    // TODO: can malicious user use a nonce twice?
    const {nonce: nonceId, appId, seed} = data;

    // console.log('TssPlugin.__recoverMyKey', data, callerInfo.wallet)
    const appParty = this.getAppParty(appId, seed)
    if(!appParty)
      throw `Missing app Party.`

    if(!appParty.partners.includes(callerInfo.id))
      throw `Only partners can can request to recover the key`

    const appTssKey: AppTssKey|null = this.getAppTssKey(appId, seed)

    // if(!this.tssKey || !this.tssParty){
    if(!appTssKey){
        throw "Tss not initialized"
    }

    if (nonceId === appTssKey!.id)
      throw `Cannot use tss key as nonce`;

    let nonce: AppTssKey = await this.getSharedKey(nonceId);
    await useOneTime("key", nonce.publicKey!.encode('hex', true), `app-${appId}-tss-recovery`, 3600)
    let keyPart = nonce.share!.add(appTssKey.share!).umod(tssModule.curve.n!);

    const appTssKeyJson: AppTssKeyJson = appTssKey.toJson();
    return {
      id: appTssKey!.id,
      recoveryShare: `0x${keyPart.toString(16, 64)}`,
      // distributed key public
      publicKey: `${appTssKey!.publicKey!.encode('hex', true)}`,
      // distributed key address
      address: tssModule.pub2addr(appTssKey!.publicKey!),

      polynomial: appTssKeyJson.polynomial
    }
  }

  /**
   * Node with ID:[1] inform other nodes that tss creation completed.
   *
   * @param data
   * @param callerInfo: caller node information
   * @param callerInfo.wallet: collateral wallet of caller node
   * @param callerInfo.peerId: PeerID of caller node
   * @returns {Promise<boolean>}
   * @private
   */
  @remoteMethod(RemoteMethods.storeDeploymentTssKey)
  async __storeDeploymentTssKey(data: {party: string, key: string}, callerInfo) {
    // TODO: problem condition: request arrive when tss is ready
    let {party: partyId, key: keyId} = data
    let party = this.getParty(partyId)
    let key: AppTssKey = await this.getSharedKey(keyId);
    if (!party)
      throw {message: 'TssPlugin.storeDeploymentTssKey: party not found.'}
    if (!key)
      throw {message: 'TssPlugin.storeDeploymentTssKey: key not found.'};
    if(callerInfo.id==LEADER_ID && await this.isNeedToCreateKey()) {
      await useOneTime("key", key.publicKey!.encode('hex', true), `app-1-tss`)
      this.saveTssConfig(party, key);
      this.tssKey = key
      this.isReady = true;
      CoreIpc.fireEvent({type: "deployment-tss-key:generate", data: key.toJson()});
      log('save done')
      // CoreIpc.fireEvent({type: "tss:generate", })
      return true;
    }
    else{
      throw "Not permitted to create tss key"
    }
  }
}

export default TssPlugin;
