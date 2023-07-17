import { logger } from "@libp2p/logger";
import axios, { AxiosInstance } from "axios";
import { CID } from "multiformats/cid";
import PQueue from "p-queue";
import defer from "p-defer";
import errCode from "err-code";
import type { PeerId } from "@libp2p/interface-peer-id";
import type { AbortOptions } from "ipfs-core-types/src/utils";
import type { PeerRouting } from "@libp2p/interface-peer-routing";
import type { PeerInfo } from "@libp2p/interface-peer-info";
import type { Startable } from "@libp2p/interfaces/startable";
import { peerIdFromBytes, peerIdFromString } from "@libp2p/peer-id";
import { multiaddr } from "@multiformats/multiaddr";
import { parseBool, timeout } from "../utils/helpers.js";
import * as crypto from "../utils/crypto.js";
import { muonSha3 } from "../utils/sha3.js";
import { isPrivate } from "./utils.js";
import _ from 'lodash';

const log = logger("muon:network:routing");

const FINDPEER_DEFAULT_TIMEOUT = 30e3; // 30 second default
const CONCURRENT_HTTP_REQUESTS = 10;

export type MuonRoutingInit = {
  /**
   List of routing service providers
   */
  baseUrls: string[];

  /**
   Discovery interval.

   Default: 300000 (every 5 minutes)
   */
  discoveryInterval?: number;

  /**
   This flag prevents the node from publishing
   its peerInfo if it is true

   Default: false
   */
  listenOnly?: boolean;
};

export interface HTTPClientExtraOptions {
  headers?: Record<string, string>;
  searchParams?: URLSearchParams;
}

export class MuonRouting implements PeerRouting, Startable {
  private readonly init;
  private readonly components;
  private readonly apis: AxiosInstance[];
  private readonly httpQueue: PQueue;
  private started: boolean;
  private abortController: AbortController;
  private discoveryInterval: number;
  private listenOnly: boolean;

  constructor(init: MuonRoutingInit, components: any) {
    log("Initalizing MuonRouting ...");
    this.init = init;
    this.discoveryInterval = init?.discoveryInterval ?? 5 * 60000;
    this.listenOnly = init?.listenOnly ?? false;
    this.components = components;

    this.started = false;
    this.abortController = new AbortController();

    // limit concurrency to avoid request flood
    // https://github.com/libp2p/js-libp2p-delegated-content-routing/issues/12
    this.httpQueue = new PQueue({
      concurrency: CONCURRENT_HTTP_REQUESTS,
    });

    this.apis = init.baseUrls.map((baseUrl) =>
      axios.create({
        baseURL: baseUrl,
        responseType: "json",
        timeout: 5000,
      })
    );

    log(`MuonRouting endpoints: `, init.baseUrls);
  }

  isStarted() {
    return this.started;
  }

  start() {
    this.started = true;
  }

  stop() {
    this.httpQueue.clear();
    this.abortController.abort();
    this.abortController = new AbortController();
    this.started = false;
  }

  afterStart() {
    // Don't publish on listenOnly mode
    if (this.listenOnly) {
      return;
    }

    // Broadcasts immediately once, and then repeats
    // on a regular interval
    this._discovery();
  }

  /**
   * Selects a delegate node at random and attempts to find
   * the peerInfo associated with the given PeerId
   */
  async findPeer(
    id: PeerId,
    options: HTTPClientExtraOptions & AbortOptions = {}
  ) {
    log("findPeer starts: %p", id);

    options.timeout = options.timeout ?? FINDPEER_DEFAULT_TIMEOUT;
    // options.signal = anySignal(
    //   [this.abortController.signal].concat(
    //     options.signal != null ? [options.signal] : []
    //   )
    // );

    const onStart = defer();
    const onFinish = defer();

    void this.httpQueue.add(async () => {
      onStart.resolve();
      return await onFinish.promise;
    });

    try {
      await onStart.promise;

      const randomIndexs = _.shuffle(_.range(this.apis.length)).slice(0,2);
      const apis = randomIndexs.map(i => this.apis[i])
      log(`Calling delegate server %o ...`, apis.map(api => api.defaults.baseURL));

      const timestamp = Date.now();
      const hash = muonSha3(
        {type: "uint64", value: timestamp},
        {type: "string", value: `${this.components.peerId}`},
      );

      const findPeerData = {
        signature: crypto.sign(hash),
        timestamp: timestamp,
        requesterId: this.components.peerId,
        id: `${id}`
      };

      // @ts-ignore
      let result = await Promise.any(
        apis.map(api => {
          return api.post(
            "/findpeer",
            findPeerData,
            {
              timeout: options.timeout,
            }
          )
            .then(({data}) => {
              if(!data?.peerInfo)
                throw `Peer ${id} not found`
              return data
            })
        })
      )
        .catch(e => ({}))

      log(`Delegate server response %O`, result);
      let info = result?.peerInfo;
      if (!info) {
        throw `Peer ${id} not found`;
      }

      const peerInfo: PeerInfo = {
        id: peerIdFromString(info.id),
        multiaddrs: info.multiaddrs.map((ma) => multiaddr(ma)),
        protocols: [],
      };
      return peerInfo;
    } catch (err: any) {
      log.error("findPeer errored: %o", err);

      throw err;
    } finally {
      onFinish.resolve();
      log("findPeer finished: %p", id);
    }

    throw errCode(new Error("Not found"), "ERR_NOT_FOUND");
  }

  /**
   * Attempts to find the closest peers
    on the network
   * to the given key.
   */
  async *getClosestPeers(
    key: Uint8Array,
    options: HTTPClientExtraOptions & AbortOptions = {}
  ) {
    yield* [];
  }

  /**
   * Sends the current node's peer info to all
   * of the delegate nodes.

   * It sends once and then schedules to repeat
   * at regular intervals
   */
  async _discovery() {
    log(`MuonRouting discovery strated.`);
    const peerId = this.components.peerId;

    if (peerId.publicKey == null) {
      throw new Error("PeerId is not valid.");
    }

    while (true) {
      log(`Sending discovery data ...`);
      try {
        let multiAddrs = this.components.addressManager.getAddresses();

        // By default the nodes do not publish their private/local ips
        // Local Muon simulators can enable publishing local ips.
        let allowPrivateIps = parseBool(process.env.DISABLE_ANNOUNCE_FILTER!);

        let gatewayPort: number = parseInt(process.env.GATEWAY_PORT!);
        if (!allowPrivateIps)
          multiAddrs = multiAddrs.filter((ma) => !isPrivate(ma));

        if (multiAddrs.length == 0) {
          throw `MuonRouting multiaddrs is empty.`;
        }

        const peerInfo = {
          id: `${peerId}`,
          multiaddrs: multiAddrs.map((ma) => ma.toString()),
          protocols: [],
        };

        const timestamp = Date.now();
        const hash = muonSha3(
          { type: "uint16", value: gatewayPort },
          { type: "uint64", value: timestamp },
          { type: "string", value: peerInfo.id },
          ...peerInfo.multiaddrs.map((value) => ({ type: "string", value }))
        );

        const discoveryData = {
          gatewayPort,
          peerInfo,
          timestamp,
          signature: crypto.sign(hash),
        };

        // @ts-ignore
        const responses = await Promise.any(
          this.apis.map((api) => {
            return api
              .post("/discovery", discoveryData, { timeout: 5000 })
              .then(({ data }) => data)
              .catch((e) => {
                const errorMessage =
                  e?.response?.data?.error || e?.message || "unknown error";
                log.error(
                  `Error on calling delegate node: ${api.defaults.baseURL} %O`,
                  errorMessage
                );
                return e.message || "unknown error";
              });
          })
        );

        log("Discovery responses: %o", responses);
      } catch (e) {
        log.error(`Discovery error: %O`, e);
        await timeout(5000);
        continue;
      }

      // randomize time of the next call
      const deltaTime = (Math.random() - 0.5) * this.discoveryInterval;
      await timeout(this.discoveryInterval + deltaTime);
    }
  }
}

export function muonRouting(
  init: MuonRoutingInit
): (components?: any) => PeerRouting {
  return (components?: any) => new MuonRouting(init, components);
}
