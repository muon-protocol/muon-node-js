import CallablePlugin from './base/callable-plugin.js'
import DistributedKey from "../../utils/tss/distributed-key.js";
import lodash from 'lodash'
import * as tssModule from '../../utils/tss/index.js'
import Web3 from 'web3'
import {timeout, stackTrace, uuid, pub2json} from '../../utils/helpers.js'
import {remoteApp, remoteMethod, broadcastHandler} from './base/app-decorators.js'
import CollateralInfoPlugin from "./collateral-info.js";
import * as SharedMemory from '../../common/shared-memory/index.js'
import * as NetworkIpc from '../../network/ipc.js'
import * as CoreIpc from '../ipc.js'
import {AppContext, MuonNodeInfo, PartyInfo} from "../../common/types";
import AppManager from "./app-manager.js";
import TssParty from "../../utils/tss/party.js";
import {IMpcNetwork} from "../../common/mpc/types";
import {DistributedKeyGeneration} from "../../common/mpc/dkg.js";
import {DistKey} from "../../common/mpc/dist-key.js";
import {logger} from '@libp2p/logger'
import {bn2hex} from "../../utils/tss/utils.js";
import {useOneTime} from "../../utils/tss/use-one-time.js";

const {shuffle} = lodash;
const {utils:{toBN}} = Web3;
const log = logger('muon:core:plugins:tss')

const LEADER_ID = process.env.LEADER_ID || '1';

export type PartyGenOptions = {
  /**
   * Party ID
   */
  id?: string,
  /**
   * Party Threshold
   */
  t: number,
  /**
   * Exact partners of party
   */
  partners?: string[]
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

const BroadcastMessage = {
  WhoIsThere: 'BROADCAST_MSG_WHO_IS_THERE',
};

const RemoteMethods = {
  recoverMyKey: 'recoverMyKey',
  createParty: 'createParty',
  keyGenStep1: 'kgs1',
  keyGenStep2: 'kgs2',
  storeTssKey: 'storeTssKey',
  iAmHere: "iAmHere",
  checkTssStatus: "checkTssStatus",
}

@remoteApp
class TssPlugin extends CallablePlugin {
  isReady = false
  parties:{[index: string]: TssParty} = {}
  tssKey: DistributedKey | null = null;
  tssParty: TssParty | null = null;
  /**
   map appId and seed to App TSS key
   example: appTss[appId][seed] = DistributedKey
   */
  appTss:{[index: string]: {[index: string]: DistributedKey}} = {}

  async onStart() {
    super.onStart();

    this.muon.on("collateral:node:add", this.onNodeAdd.bind(this));
    this.muon.on("collateral:node:edit", this.onNodeEdit.bind(this));
    this.muon.on("collateral:node:delete", this.onNodeDelete.bind(this));

    this.muon.on('app-context:delete', this.onAppContextDelete.bind(this))
    this.muon.on('global-tss-key:generate', this.onTssKeyGenerate.bind(this));
    this.muon.on('party:generate', this.loadParty.bind(this));

    // @ts-ignore
    this.appManager.on('app-tss:delete', this.onAppTssDelete.bind(this))

    await this.collateralPlugin.waitToLoad()
    await this.appManager.waitToLoad();
    this.loadTssInfo();

  }

  async onNodeAdd(nodeInfo: MuonNodeInfo) {
    log(`node add %o`, nodeInfo)

    //await timeout(5000);

    const selfInfo = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!);
    if(!selfInfo) {
      log(`current node not in the network yet.`)
      return;
    }

    if(selfInfo.id === nodeInfo.id){
      log(`current node added to the network and loading tss info.`)
      this.loadTssInfo()
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
      const selfInfo = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)
      if(!selfInfo)
        return ;

      if(nodeInfo.isDeployer) {
        if(nodeInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
          await this.loadTssInfo()
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

  get TSS_THRESHOLD() {
    return this.muon.configs.net.tss.threshold;
  }

  get TSS_MAX() {
    return this.muon.configs.net.tss.max;
  }

  private get collateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral')
  }

  private get appManager(): AppManager {
    return this.muon.getPlugin('app-manager');
  }

  getTssConfig(){
    let {tss: tssConfig} = this.muon.configs;
    if(!tssConfig)
      return null;

    if(!tssConfig.party.t) {
      return null;
    }

    return tssConfig;
  }

  async loadTssInfo() {
    if(!this.collateralPlugin.networkInfo){
      throw {message: `TssPlugin.loadTssInfo: collateral plugin not loaded the network info.`}
    }
    let {networkInfo} = this.collateralPlugin;

    const currentNodeInfo = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)

    /** current node not in the network */
    if(!currentNodeInfo || !currentNodeInfo.isDeployer) {
      return;
    }
    log(`loading global tss info ...`)

    //TODO: handle {isValid: false};

    this.tssParty = this.getAppParty("1", "1")!;
    log(`tss party loaded.`)

    // @ts-ignore
    this.emit('party-load');

    // this.tryToFindOthers(3);

    // validate tssConfig
    let tssConfig = this.getTssConfig();

    if(tssConfig && tssConfig.party.t == networkInfo.tssThreshold){
      let _key = {
        ...tssConfig.key,
        share: toBN(tssConfig.key.share),
        publicKey: tssModule.keyFromPublic(tssConfig.key.publicKey)
      }
      let key = DistributedKey.load(this.tssParty, _key);
      this.tssKey = key;
      this.isReady = true
      log('tss ready');
    }
    else{
      /** only one process allowed to create or recover Tss Key */
      let permitted = await NetworkIpc.askClusterPermission('tss-key-creation', 20000)
      if(!permitted)
        return;

      log('waiting for the threshold number of deployers to get online ...')
      let onlineDeployers: string[];
      while (true) {
        const deployers: string[] = this.collateralPlugin.filterNodes({isDeployer: true}).map(p => p.peerId)
        onlineDeployers = await NetworkIpc.findNOnlinePeer(
          deployers,
          Math.ceil(this.tssParty.t*1.3),
          {timeout: 5000}
        );

        if(onlineDeployers.length >= this.collateralPlugin.TssThreshold) {
          log(`${onlineDeployers.length} number of deployers are now online.`)
          break;
        }

        /** wait 5 seconds and retry again */
        log("online deployers %o", onlineDeployers)
        log(`waiting: only ${onlineDeployers.length} number of deployers are online.`)
        await timeout(5000);
      }

      const currentNodeInfo = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)
      if (currentNodeInfo && currentNodeInfo.id == LEADER_ID && await this.isNeedToCreateKey()) {
        log(`Got permission to create tss key`);
        let key: DistributedKey = await this.tryToCreateTssKey();
        log(`TSS key generated with ${key.partners.length} partners`);
      }
      else{
        log(`trying to recover global tss key... timeout(6000)`)

        while (!this.isReady) {
          log("waiting for tss, timeout(5000)");
          await timeout(5000);
          const context: AppContext = this.appManager.getAppContext("1", "1")
          const readyPartners = await this.getTssReadyPartners('1', '1')

          if(readyPartners.length >= context.party.t){
            log(`global tss is ready.`);
            try {
              await this.tryToRecoverGlobalTssKey(readyPartners!);
            }
            catch (e) {
              log(`Error when trying to recover tss key`);
            }
          }
          else {
            log(`global tss is not ready.`);
          }
        }
      }
    }
  }

  /**
   * Query from the network to check that Tss is ready or not
   */
  async getTssReadyPartners(appId: string, seed: string): Promise<MuonNodeInfo[]> {
    const context = this.appManager.getAppContext(appId, seed);
    if(!context)
      return []
    let partners: MuonNodeInfo[] = this.collateralPlugin
      .filterNodes({
        list: context.party.partners,
        excludeSelf: true
      });

    let statuses = await Promise.all(partners.map(p => {
      return this.remoteCall(
        p.peerId,
        RemoteMethods.checkTssStatus,
        {appId, seed}
      ).catch(e => 'error')
    }))

    let isReadyArr = statuses.map(s => s.isReady)
    const readyPartners = partners.filter((p, i) => isReadyArr[i])

    return readyPartners
  }

  getAppTssKey(appId: string, seed: string): DistributedKey | null {
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
      const key = DistributedKey.load(party, {
        id: `app-${appId}`,
        share: _key.keyShare,
        publicKey: _key.publicKey.encoded,
        partners: context.party.partners
      })
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

  async isNeedToCreateKey(){
    const deployers: string[] = this.collateralPlugin.filterNodes({isDeployer: true}).map(p => p.peerId)
    const onlineDeployers: string[] = await NetworkIpc.findNOnlinePeer(
      deployers,
      Math.ceil(this.tssParty!.t*1.2),
      {timeout: 10000, return: 'peerId'}
    )
    if(onlineDeployers.length < this.tssParty!.t)
      return false;

    let statuses = await Promise.all(onlineDeployers.map(peerId => {
      return this.remoteCall(
        peerId,
        RemoteMethods.checkTssStatus,
        {appId: '1', seed: '1'}
      ).catch(e => 'error')
    }))

    // TODO: is this ok?
    let isReadyList: number[] = statuses.map(s => (s.isReady?1:0))
    let numReadyNodes: number = isReadyList.reduce((sum, r) => (sum+r), 0);


    return numReadyNodes < this.collateralPlugin.TssThreshold;
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
        // shared part of distributedKey
        share: `0x${key.share.toString(16)}`,
        // distributedKey public
        publicKey: `${key.publicKey.encode('hex', true)}`,
        // distributed key address
        address: tssModule.pub2addr(key.publicKey)
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

  async onTssKeyGenerate(tssKey) {
    if(!this.isReady) {
      this.tssKey = DistributedKey.load(this.tssParty, tssKey);
      this.isReady = true;
    }
  }

  private async tryToRecoverGlobalTssKey(readyPartners: MuonNodeInfo[]){
    log(`generating nonce for recovering global tss key`)

    let nonce = await this.keyGen({appId: "1", seed: "1"}, {
      id: `recovery-${uuid()}`,
      partners: [
        this.collateralPlugin.currentNodeInfo!.id,
        ...readyPartners.map(p => p.id),
      ]
    });
    log(`nonce generated for recovering global tss key`)

    const noncePartners = this.collateralPlugin.filterNodes({
      list: nonce.partners,
      excludeSelf: true,
    })
    let tssKey = await this.recoverAppTssKey('1', '1', noncePartners, nonce);

    this.tssKey = tssKey
    this.isReady = true;
    this.saveTssConfig(this.tssParty, tssKey)
    CoreIpc.fireEvent({type: "global-tss-key:generate", data: tssKey.toSerializable()});
    log(`${process.pid} tss key recovered`);
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
  async recoverAppTssKey(appId: string, seed: string, partners: MuonNodeInfo[], nonce: DistributedKey, newSeed?: string): Promise<DistributedKey> {
    let appParty = this.getAppParty(appId, seed);

    if(!appParty)
      throw `AppParty does not exist for recovering the key.`

    if(partners.length < appParty.t)
      throw {message: "No enough online partners to recover the key."};

    let keyResults = await Promise.all(
      partners.map(p => {
          return this.remoteCall(
            // online partners
            p.peerId,
            RemoteMethods.recoverMyKey,
            {nonce: nonce.id, appId, seed, newSeed},
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

    return DistributedKey.load(appParty, {
      id: keyResults[0].id,
      i: myIndex,
      share: myKey,
      publicKey: tssModule.keyFromPublic(keyResults[0].publicKey),
      address: keyResults[0].address,
    })
  }

  private appTssKeyRecoveryCheckTime = 0;
  async checkAppTssKeyRecovery(appId: string, seed: string) {
    if(this.appTssKeyRecoveryCheckTime + 5*60e3 < Date.now()){
      log(`checking to recover app[${appId}] tss key`)
      this.appTssKeyRecoveryCheckTime = Date.now();
      try {
        let context: AppContext = this.appManager.getAppContext(appId, seed);
        if(!context.keyGenRequest) {
          const contexts: AppContext[] = await this.appManager.queryAndLoadAppContext(appId);
          context = contexts.find(ctx => ctx.seed === seed)!
          if(!contexts || !context.keyGenRequest)
            throw `app tss is not ready yet`
        }
        const readyPartners = await this.getTssReadyPartners(appId, seed);
        if(readyPartners.length > context.party.t) {
          log(`app[${appId}] tss is ready and can be recovered by partners `, readyPartners!.map(({id}) => id));
          log(`generating nonce for recovering app[${appId}] tss key`)
          let nonce = await this.keyGen(
            {appId, seed},
            {
              id: `recovery-${uuid()}`,
              partners: [
                this.collateralPlugin.currentNodeInfo!.id,
                ...readyPartners.map(p => p.id),
              ]
            }
          );
          log(`nonce generated for recovering app[${appId}] tss key`)
          //
          const noncePartners = this.collateralPlugin.filterNodes({
            list: nonce.partners,
            excludeSelf: true,
          })
          let key = await this.recoverAppTssKey(appId, seed, noncePartners, nonce);
          if(key) {
            log(`app tss key recovered`)
            const netConfigs = this.muon.configs.net
            let expiration: number|undefined;
            if(context.deploymentRequest && context.ttl) {
              expiration = context.deploymentRequest.data.timestamp + context.ttl + netConfigs.tss.pendingPeriod
            }
            await this.appManager.saveAppTssConfig({
              appId: appId,
              seed,
              keyGenRequest: context.keyGenRequest,
              publicKey: pub2json(key.publicKey!),
              keyShare: bn2hex(key.share!),
              expiration
            })
          }
        }
        else {
          log(`app[${appId}] tss is not ready yet`)
          throw `app tss is not ready yet`;
        }
      }
      catch (e) {
        log(`recovering app[${appId}] tss key failed %O`, e);
        throw e;
      }
    }
  }

  async tryToCreateTssKey(): Promise<DistributedKey> {
    const deployers: string[] = this.collateralPlugin.filterNodes({isDeployer: true}).map(p => p.peerId)
    while (!this.isReady) {
      log('tryToCreateTssKey:: tss is not ready. timeout(5000)')
      await timeout(5000);
      try {
        const onlineDeployers: string[] = await NetworkIpc.findNOnlinePeer(
          deployers,
          Math.ceil(this.tssParty!.t*1.2),
          {timeout: 10000}
        )
        if(onlineDeployers.length < this.tssParty!.t) {
          log(`Its need ${this.tssParty!.t} deployer to create global tss but only ${onlineDeployers.length} are available`)
          continue;
        }
        log(`Deployers %o are available to create global tss`, onlineDeployers)
        let key: DistributedKey = await this.keyGen(
          {appId: "1", seed: "1"},
          {
            partners: onlineDeployers,
            lowerThanHalfN: true
          }
        )

        let keyPartners = this.collateralPlugin.filterNodes({list: key.partners, excludeSelf: true})
        let callResult = await Promise.all(keyPartners.map(({wallet, peerId}) => {
          return this.remoteCall(
            peerId,
            RemoteMethods.storeTssKey,
            {
              party: this.tssParty!.id,
              key: key.id,
            },
            {timeout: 120e3}
            // {taskId: `keygen-${key.id}`}
          ).catch(e=>{
            console.log("RC.storeTssKey", e);
            return false
          });
        }))
        // console.log(`key save broadcast threshold: ${this.TSS_THRESHOLD} count: ${key.partners.length}`, callResult);
        if (callResult.filter(r => r === true).length+1 < this.TSS_THRESHOLD)
          throw `Tss creation failed.`
        this.saveTssConfig(this.tssParty, key)

        this.tssKey = key;
        this.isReady = true;
        CoreIpc.fireEvent({type: "global-tss-key:generate", data: key.toSerializable()});
        log('tss ready.')
      } catch (e) {
        log('error when trying to create tss key %o %o', e, e.stack);
      }
    }

    return this.tssKey!
  }

  async createParty(options: PartyGenOptions) {
    let {
      id,
      t,
      partners=[]
    } = options

    if(partners.length === 0)
      throw `Generating new Party without partners, is not implemented yet.`

    const newParty = {
      id: id || TssParty.newId(),
      t,
      max: partners.length,
      partners
    }
    if(!id || !this.parties[id])
      CoreIpc.fireEvent({type: "party:generate", data: newParty});
    /**
     * filter partners and keep online ones.
     */
    // @ts-ignore
    const partnersToCall: MuonNodeInfo[] = this.collateralPlugin.filterNodes({
      list: partners,
    })

    let callResult = await Promise.all(
      partnersToCall
        .map(({peerId, wallet}) => {
          if(wallet === process.env.SIGN_WALLET_ADDRESS)
            return true;
          return this.remoteCall(
            peerId,
            RemoteMethods.createParty,
            newParty, // TODO: send less data. just send id and partners wallet
            {timeout: 15000}
          ).catch(e => {
            console.log("TssPlugin.createParty", e)
            return 'error'
          })
        })
    )
    const succeeded = partners.filter((p, i) => callResult[i] !== 'error')
    if(succeeded.length < newParty.t)
      throw `Only ${succeeded.length} partners succeeded when creating the party.`
    return newParty.id;
  }

  /**
   *
   * @param party
   * @param options
   * @param options.id: create key with specific id
   * @param options.maxPartners: create key that shared with at most `maxPartners` participants.
   * @returns {Promise<DistributedKey>}
   */
  async keyGen(partyInfo: PartyInfo, options: KeyGenOptions={}): Promise<DistributedKey> {
    let network: IMpcNetwork = this.muon.getPlugin('mpcnet');
    let {id, partners: oPartners, maxPartners, timeout=60000, value} = options;

    const party = this.getAppParty(partyInfo.appId, partyInfo.seed, partyInfo.isForReshare)

    if(!party)
      throw {message: `party not found`, partyInfo}

    let candidatePartners = party.partners;
    if(oPartners)
      candidatePartners = candidatePartners.filter(p => oPartners!.includes(p));

    let partners: MuonNodeInfo[] = this.collateralPlugin.filterNodes({
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
        this.collateralPlugin.currentNodeInfo!.id,
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

    // @ts-ignore
    let key = DistributedKey.load(party, {
      id: keyGen.extraParams.keyId!,
      share: bn2hex(dKey.share),
      publicKey: dKey.publicKey,
      partners: dKey.partners
    })

    await SharedMemory.set(keyGen.extraParams.keyId, key.toSerializable(), 30*60*1000)
    return key;
  }

  async getSharedKey(id: string, timeout:number=5000): Promise<DistributedKey> {
    let key = await SharedMemory.waitAndGet(id, timeout)
    let party = this.getParty(key.party);
    if(!party)
      throw `party [${key.party}] not found`
    return DistributedKey.load(party, key)
  }

  getParty(id) {
    return this.parties[id];
  }

  async handleBroadcastMessage(msg, callerInfo) {
    let {method, params} = msg;
    // console.log("TssPlugin.handleBroadcastMessage",msg, {callerInfo})
    switch (method) {
      case BroadcastMessage.WhoIsThere: {
        // console.log(`=========== InformEntrance ${wallet}@${peerId} ===========`)
        // TODO: is this message from 'wallet'
        if (!!this.tssParty) {
          this.remoteCall(
            callerInfo.peerId,
            RemoteMethods.iAmHere
          ).catch(e => {})
        }
        break;
      }
      default:
        log(`unknown message %o`, msg);
    }
  }

  @broadcastHandler
  async onBroadcastReceived(data={}, callerInfo) {
    try {
      // let data = JSON.parse(uint8ArrayToString(msg.data));
      await this.handleBroadcastMessage(data, callerInfo)
    } catch (e) {
      console.error('TssPlugin.__onBroadcastReceived', e)
    }
  }

  /**==================================
   *
   *           Remote Methods
   *
   *===================================*/

  /**
   * Each node can request other nodes to recover its own key.
   * This process will be done after creating a DistributedKey as a nonce.
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
  async __recoverMyKey(data: {nonce: string, appId: string, seed: string, newSeed?: string}, callerInfo: MuonNodeInfo) {
    // TODO: can malicious user use a nonce twice?
    const {nonce: nonceId, appId, seed, newSeed} = data;
    let newContext: AppContext, isInNewContext: boolean = false;

    if(newSeed) {
      newContext = this.appManager.getAppContext(appId, newSeed);
      if(!newContext) {
        const contexts = await this.appManager.queryAndLoadAppContext(appId, {seeds: [newSeed]})
        newContext = contexts[0]
        if(!newContext)
          throw `New context not found to allow key recovery`
      }
      if(!newContext.party.partners.includes(callerInfo.id))
        throw `New party does not include current node.`

      isInNewContext = true;
    }

    // console.log('TssPlugin.__recoverMyKey', data, callerInfo.wallet)
    const appParty = this.getAppParty(appId, seed)
    if(!appParty)
      throw `Missing app Party.`

    if(!appParty.partners.includes(callerInfo.id) && !isInNewContext)
      throw `Only partners can can request to recover the key`

    const appTssKey = this.getAppTssKey(appId, seed)

    // if(!this.tssKey || !this.tssParty){
    if(!appTssKey){
        throw "Tss not initialized"
    }

    if (nonceId === appTssKey!.id)
      throw `Cannot use tss key as nonce`;

    let nonce = await this.getSharedKey(nonceId);
    await useOneTime("key", nonce.publicKey!.encode('hex', true), `app-${appId}-tss-recovery`)
    let keyPart = nonce.share!.add(appTssKey.share!).umod(tssModule.curve.n!);
    return {
      id: appTssKey!.id,
      recoveryShare: `0x${keyPart.toString(16, 64)}`,
      // distributedKey public
      publicKey: `${appTssKey!.publicKey!.encode('hex', true)}`,
      // distributed key address
      address: tssModule.pub2addr(appTssKey!.publicKey!)
    }
  }

  @remoteMethod(RemoteMethods.createParty)
  async __createParty(data: PartyGenOptions, callerInfo) {
    // console.log('TssPlugin.__createParty', data)
    if(!data.id || !this.parties[data.id]) {
      CoreIpc.fireEvent({
        type: "party:generate",
        data
      });
    }
    return "OK"
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
  @remoteMethod(RemoteMethods.storeTssKey)
  async __storeTssKey(data: {party: string, key: string}, callerInfo) {
    // TODO: problem condition: request arrive when tss is ready
    // console.log('TssPlugin.__storeTssKey', data)
    let {party: partyId, key: keyId} = data
    let party = this.getParty(partyId)
    let key = await this.getSharedKey(keyId);
    if (!party)
      throw {message: 'TssPlugin.__storeTssKey: party not found.'}
    if (!key)
      throw {message: 'TssPlugin.__storeTssKey: key not found.'};
    if(callerInfo.id==LEADER_ID && await this.isNeedToCreateKey()) {
      this.saveTssConfig(party, key);
      this.tssKey = key
      this.isReady = true;
      CoreIpc.fireEvent({type: "global-tss-key:generate", data: key.toSerializable()});
      log('save done')
      // CoreIpc.fireEvent({type: "tss:generate", })
      return true;
    }
    else{
      throw "Not permitted to create tss key"
    }
  }

  @remoteMethod(RemoteMethods.iAmHere)
  async __iAmHere(data={}, callerInfo) {
    // console.log('TssPlugin.__iAmHere', data)
  }

  @remoteMethod(RemoteMethods.checkTssStatus)
  async __checkTssStatus(data:{appId: string, seed: string}, callerInfo): Promise<{isReady: boolean, address?: string}> {
    const {appId, seed} = data

    const appTssKey = this.getAppTssKey(appId, seed)

    if(!appTssKey) {
      return {isReady: false}
    }

    return {
      isReady: !!appTssKey,
      address: appTssKey?.address,
    }
  }
}

export default TssPlugin;
