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

const log = logger('muon:network:routing')

const DEFAULT_TIMEOUT = 30e3 // 30 second default
const CONCURRENT_HTTP_REQUESTS = 4

export type MuonRoutingInit = {
  /** list of routing service providers */
  baseUrls: string[],
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

  constructor(init: MuonRoutingInit, components: any) {
    this.init = init;
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

  /**
   * Attempts to find the given peer
   */
  async findPeer(id: PeerId, options: HTTPClientExtraOptions & AbortOptions = {}) {
    log('findPeer starts: %p', id)

    options.timeout = options.timeout ?? DEFAULT_TIMEOUT;
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
      let result = await this.apis[randomIndex].post('/findpeer', {peerId: `${id}`})
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
    let cidOrPeerId: CID | PeerId
    const cid = CID.asCID(key)

    if (cid != null) {
      cidOrPeerId = cid
    } else {
      cidOrPeerId = peerIdFromBytes(key)
    }

    log('getClosestPeers starts: %s', cidOrPeerId)
    options.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    options.signal = anySignal([this.abortController.signal].concat((options.signal != null) ? [options.signal] : []))

    const onStart = defer()
    const onFinish = defer()

    void this.httpQueue.add(async () => {
      onStart.resolve()
      return await onFinish.promise
    })

    try {
      await onStart.promise

      const randomIndex = Math.floor(Math.random() * this.apis.length)
      log(`send query to delegate server %o ...`, this.apis[randomIndex].defaults.baseURL)
      let result = await this.apis[randomIndex].post('/query', cid ? {cid: cidOrPeerId.toString()} : {peerId: cidOrPeerId.toString()})
        .then(({data}) => data)

      log(`query response %o`, (result?.list ?? []).map(p => p.id))
      let list = result?.list
      if(!list)
        throw `peer list not found`

      yield * list.map(info => ({
        id: peerIdFromString(info.id),
        multiaddrs: info.multiaddrs.map(ma => multiaddr(ma)),
        protocols: []
      }));
    } catch (err) {
      log.error('getClosestPeers errored:', err)
      throw err
    } finally {
      onFinish.resolve()
      log('getClosestPeers finished: %b', key)
    }
  }
}

export function muonRouting(init: MuonRoutingInit): (components?: any) => PeerRouting {
  return (components?: any) => new MuonRouting(init, components);
}
