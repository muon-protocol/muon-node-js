import { logger } from '@libp2p/logger'
import axios, {AxiosInstance} from 'axios'
import { CID } from 'multiformats/cid'
import PQueue from 'p-queue'
import defer from 'p-defer'
import errCode from 'err-code'
import anySignal from 'any-signal'
import type { PeerId } from '@libp2p/interface-peer-id'
import type { AbortOptions } from 'ipfs-core-types/src/utils'
import type { PeerRouting } from '@libp2p/interface-peer-routing'
import type { PeerInfo } from '@libp2p/interface-peer-info'
import type { Startable } from '@libp2p/interfaces/startable'
import { peerIdFromBytes, peerIdFromString } from '@libp2p/peer-id'
import { multiaddr } from '@multiformats/multiaddr'
import {parseBool, timeout} from "../utils/helpers.js";
import * as crypto from '../utils/crypto.js'
import soliditySha3 from "../utils/soliditySha3.js";
import {isPrivate} from "./utils.js";

const log = logger('muon:network:routing')

const FINDPEER_DEFAULT_TIMEOUT = 30e3 // 30 second default
const CONCURRENT_HTTP_REQUESTS = 4

export type MuonRoutingInit = {
  /**
   List of routing service providers
   */
  baseUrls: string[],
  /**
   Discovery interval.
   Default: 300000 (every 5 minutes)
   */
  discoveryInterval?: number,
  /**
   IF true, we will not send our discovery data
   Default: false
   */
  listenOnly?: boolean
}

export interface HTTPClientExtraOptions {
  headers?: Record<string, string>
  searchParams?: URLSearchParams
}

export class MuonRouting implements PeerRouting, Startable {

  private readonly init;
  private readonly components;
  private readonly apis: AxiosInstance[];
  private readonly httpQueue: PQueue
  private started: boolean
  private abortController: AbortController
  private discoveryInterval: number
  private listenOnly: boolean

  constructor(init: MuonRoutingInit, components: any) {
    log('initializing ...')
    this.init = init;
    this.discoveryInterval = init?.discoveryInterval ?? 5*60000;
    this.listenOnly = init?.listenOnly ?? false
    this.components = components;

    this.started = false
    this.abortController = new AbortController()

    // limit concurrency to avoid request flood in web browser
    // https://github.com/libp2p/js-libp2p-delegated-content-routing/issues/12
    this.httpQueue = new PQueue({
      concurrency: CONCURRENT_HTTP_REQUESTS
    })

    this.apis = init.baseUrls.map(baseUrl => axios.create({
      baseURL: baseUrl,
      responseType: 'json',
    }))

    log(`enabled via %o`, init.baseUrls)
  }

  isStarted () {
    return this.started
  }

  start () {
    this.started = true
  }

  stop () {
    this.httpQueue.clear()
    this.abortController.abort()
    this.abortController = new AbortController()
    this.started = false
  }

  afterStart() {
    // Don't broadcast if we are only listening
    if (this.listenOnly) {
      return
    }

    // Broadcast immediately, and then run on interval
    this._discovery()
  }

  /**
   * Attempts to find the given peer
   */
  async findPeer(id: PeerId, options: HTTPClientExtraOptions & AbortOptions = {}) {
    log('findPeer starts: %p', id)

    options.timeout = options.timeout ?? FINDPEER_DEFAULT_TIMEOUT;
    options.signal = anySignal([this.abortController.signal].concat((options.signal != null) ? [options.signal] : []));

    const onStart = defer()
    const onFinish = defer()

    void this.httpQueue.add(async () => {
      onStart.resolve()
      return await onFinish.promise
    })

    try {
      await onStart.promise

      const randomIndex = Math.floor(Math.random() * this.apis.length)
      log(`requesting to delegate server %o ...`, this.apis[randomIndex].defaults.baseURL)
      let result = await this.apis[randomIndex].post('/findpeer', {id: `${id}`})
        .then(({data}) => data)

      log(`delegate server response %O`, result)
      let info = result?.peerInfo
      if(!info)
        throw `peer not found`

      const peerInfo: PeerInfo = {
        id: peerIdFromString(info.id),
        multiaddrs: info.multiaddrs.map(ma => multiaddr(ma)),
        protocols: []
      }
      return peerInfo
    } catch (err: any) {
      log.error('findPeer errored: %o', err)

      throw err
    } finally {
      onFinish.resolve()
      log('findPeer finished: %p', id)
    }

    throw errCode(new Error('Not found'), 'ERR_NOT_FOUND')
  }

  /**
   * Attempt to find the closest peers on the network to the given key
   */
  async * getClosestPeers (key: Uint8Array, options: HTTPClientExtraOptions & AbortOptions = {}) {
      yield * []
  }

  async _discovery () {
    log(`discovery started.`)
    const peerId = this.components.peerId

    if (peerId.publicKey == null) {
      throw new Error('PeerId was missing public key')
    }

    while (true) {
      log(`sending discovery data ...`);
      try {
        let multiAddrs = this.components.addressManager.getAddresses()
        let allowPrivateIps = parseBool(process.env.DISABLE_ANNOUNCE_FILTER!)
        if (!allowPrivateIps)
          multiAddrs = multiAddrs.filter(ma => !isPrivate(ma))

        const peerInfo = {
          id: `${peerId}`,
          multiaddrs: multiAddrs.map(ma => ma.toString()),
          protocols: []
        }


        const timestamp = Date.now();
        const hash = soliditySha3([
          {type: "uint64", value: timestamp},
          {type: "string", value: peerInfo.id},
          ...(
            peerInfo.multiaddrs.map(value => ({type: "string", value}))
          )
        ])

        const discoveryData = {
          peerInfo,
          timestamp,
          signature: crypto.sign(hash)
        }

        // @ts-ignore
        await Promise.any(this.apis.map(api => {
          return api.post('/discovery', discoveryData)
        }))

        log('discovery sent successfully')
      }catch (e) {
        log.error(`discovery error: %O`, e)
      }

      const deltaTime = (Math.random() - 0.5) * this.discoveryInterval
      await timeout(this.discoveryInterval + deltaTime)
    }
  }
}

export function muonRouting(init: MuonRoutingInit): (components?: any) => PeerRouting {
  return (components?: any) => new MuonRouting(init, components);
}
