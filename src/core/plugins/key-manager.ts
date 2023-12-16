import CallablePlugin from './base/callable-plugin.js'
import AppTssKey from "../../utils/tss/app-tss-key.js";
import lodash from 'lodash'
import * as TssModule from '../../utils/tss/index.js'
import {uuid} from '../../utils/helpers.js'
import {remoteApp, remoteMethod} from './base/app-decorators.js'
import NodeManagerPlugin from "./node-manager.js";
import * as SharedMemory from '../../common/shared-memory/index.js'
import * as NetworkIpc from '../../network/ipc.js'
import {AppContext, MuonNodeInfo, PartyInfo} from "../../common/types";
import AppManager from "./app-manager.js";
import {IMpcNetwork} from "../../common/mpc/types";
import {DistributedKeyGeneration} from "../../common/mpc/dkg.js";
import {DistKey} from "../../common/mpc/dist-key.js";
import {logger} from '@libp2p/logger'
import {KeyReDistOpts, KeyRedistribution} from "../../common/mpc/kdist.js";
import MpcNetworkPlugin from "./mpc-network";
import {PublicKey} from "../../utils/tss/types";
import * as crypto from "../../utils/crypto.js";
import {muonSha3} from "../../utils/sha3.js";
import {bn2hex} from "../../utils/tss/utils.js";

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

const RemoteMethods = {
  KeyShareProof: "keyShareProof",
}

@remoteApp
class KeyManager extends CallablePlugin {
  /**
   map appId and seed to App TSS key
   example: appTss[appId][seed] = AppTssKey
   */
  appTss:{[index: string]: {[index: string]: AppTssKey}} = {}

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

    const readyDeployers = await this.appManager.findNAvailablePartners(
      deployers,
      this.netConfigs.tss.threshold,
      {appId: "1", seed: "1"}
    )
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
            lowerThanHalfN
        :
          options.lowerThanHalfN,
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
}

export default KeyManager;
