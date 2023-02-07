import CallablePlugin from './base/callable-plugin.js'
import {PeerInfo} from "@libp2p/interface-peer-info";
import {remoteApp, remoteMethod, ipcMethod} from './base/app-decorators.js'
import {IpcCallOptions, JsonPeerInfo, MuonNodeInfo} from "../../common/types";
import CollateralInfoPlugin, {NodeFilterOptions} from "./collateral-info.js";
import QueueProducer from "../../common/message-bus/queue-producer.js";
import _ from 'lodash';
import RemoteCall from "./remote-call.js";
import NetworkBroadcastPlugin from "./network-broadcast.js";
import NetworkDHTPlugin from "./network-dht.js";
import NetworkContentPlugin from "./content-plugin.js";
import {timeout} from '../../utils/helpers.js'
import NodeCache from 'node-cache'
import * as CoreIpc from '../../core/ipc.js'
import Log from '../../common/muon-log.js'

const log = Log('muon:network:plugins:ipc-handler')
let requestQueue = new QueueProducer(`gateway-requests`);

const tasksCache = new NodeCache({
  stdTTL: 6 * 60, // Keep distributed keys in memory for 6 minutes
  // /**
  //  * (default: 600)
  //  * The period in seconds, as a number, used for the automatic delete check interval.
  //  * 0 = no periodic check.
  //  */
  checkperiod: 60,
  useClones: false,
});

export const IpcMethods = {
  FilterNodes: "filter-nodes",
  GetOnlinePeers: "get-online-peers",
  GetCollateralInfo: "get-collateral-info",
  SubscribeToBroadcastChannel: "subscribe-to-broadcast-channel",
  BroadcastToChannel: "broadcast-to-channel",
  PutDHT: "put-dht",
  GetDHT: "get-dht",
  ReportClusterStatus: "report-cluster-status",
  AskClusterPermission: "ask-cluster-permission",
  AssignTask: "assign-task",
  RemoteCall: "remote-call",
  GetPeerInfo: "GPI",
  GetPeerInfoLight: "GPILight",
  GetClosestPeer: "GCPeer",
  ContentRoutingProvide: "content-routing-provide",
  ContentRoutingFind: "content-routing-find",
  ForwardGatewayRequest: "forward-gateway-request",
  GetCurrentNodeInfo: "get-current-node-info",
  AllowRemoteCallByShieldNode: "allow-remote-call-by-shield-node",
  IsCurrentNodeInNetwork: "is-current-node-in-network",
  GetUptime: "get-uptime",
  FindNOnlinePeer: "FNOP",
  GetConnectedPeerIds: "GCPIDS"
} as const;

export const RemoteMethods = {
  ExecIpcRemoteCall: "exec-ipc-remote-call",
  ExecGateWayRequest: 'exec-gateway-request',
}

type IpcKeys = keyof typeof IpcMethods;
export type NetworkIpcMethod = typeof IpcMethods[IpcKeys];

@remoteApp
class NetworkIpcHandler extends CallablePlugin {

  clustersPids: { [pid: string]: number } = {};

  async onStart() {
    super.onStart()

    // @ts-ignore
    this.network.once('peer:connect', async (peerId) => {
      await timeout(5000);
    })
  }

  get broadcastPlugin(): NetworkBroadcastPlugin {
    return this.network.getPlugin('broadcast')
  }

  get DHTPlugin(): NetworkDHTPlugin {
    return this.network.getPlugin('dht')
  }

  get collateralPlugin(): CollateralInfoPlugin {
    return this.network.getPlugin('collateral');
  }

  get remoteCallPlugin(): RemoteCall {
    return this.network.getPlugin('remote-call');
  }

  get contentPlugin(): NetworkContentPlugin {
    return this.network.getPlugin('content');
  }

  get RemoteCallExecEndPoint(): string {
    return this.remoteMethodEndpoint(RemoteMethods.ExecIpcRemoteCall);
  }

  /**
   * @private
   * @ returns {Promise<MuonNodeInfo[]>} - Filter and get nodes list
   */
  @ipcMethod(IpcMethods.FilterNodes)
  async __filterNodes(filter: NodeFilterOptions): Promise<MuonNodeInfo[]> {
    return this.collateralPlugin.filterNodes(filter)
      .map(({id, staker, wallet, peerId, isOnline, isDeployer}) => ({id, staker, wallet, peerId, isOnline, isDeployer}));
  }

  /**
   * @private
   * @ returns {Promise<string[]>} - list of online peers peerId
   */
  @ipcMethod(IpcMethods.GetOnlinePeers)
  async __onGetOnlinePeers(): Promise<string[]> {
    return this.collateralPlugin.onlinePeers;
  }

  @ipcMethod(IpcMethods.GetCollateralInfo)
  async __onIpcGetCollateralInfo(data = {}, callerInfo) {
    // console.log(`NetworkIpcHandler.__onIpcGetCollateralInfo`, data, callerInfo);
    const collateralPlugin: CollateralInfoPlugin = this.network.getPlugin('collateral');
    // await collateralPlugin.waitToLoad();

    let {groupInfo, networkInfo} = collateralPlugin;
    return {
      contract: this.network.configs.net.nodeManager,
      groupInfo,
      networkInfo,
      nodesList: await collateralPlugin.getNodesList(),
      // nodesList: (await collateralPlugin.getNodesList()).map(item => _.omit(item, ['peer']))
    }
  }

  @ipcMethod(IpcMethods.SubscribeToBroadcastChannel)
  async __subscribeToBroadcastChannel(channel: string) {
    await this.broadcastPlugin.subscribe(channel);
  }

  @ipcMethod(IpcMethods.BroadcastToChannel)
  async __broadcastToChannel(data: {channel: string, message: any}) {
    // console.log("NetworkIpcHandler.__broadcastToChannel", data);
    this.broadcastToChannel(data.channel, data.message);
    return "Ok"
  }

  @ipcMethod(IpcMethods.PutDHT)
  async __putDHT(data: {key: string, value: any}) {
    let ret = await this.DHTPlugin.put(data.key, data.value);
    return ret
  }

  @ipcMethod(IpcMethods.GetDHT)
  async __getDHT(data: {key: string}) {
    return await this.DHTPlugin.get(data.key);
  }

  assignTaskToProcess(taskId: string, pid: number) {
    tasksCache.set(taskId, pid);
  }

  takeRandomProcess(): number {
    let pList = Object.values(this.clustersPids);
    const index = Math.floor(Math.random() * pList.length)
    return pList[index]
  }

  @ipcMethod(IpcMethods.ReportClusterStatus)
  async __reportClusterStatus(data: { pid: number, status: "start" | "exit" }) {
    // console.log("NetworkIpcHandler.__reportClusterStatus", {data,callerInfo});
    let {pid, status} = data
    switch (status) {
      case "start":
        this.clustersPids[pid] = pid
        break;
      case "exit":
        delete this.clustersPids[pid];
        break;
    }
    // console.log("NetworkIpcHandler.__reportClusterStatus", this.clustersPids);
  }

  clusterPermissions = {};

  @ipcMethod(IpcMethods.AskClusterPermission)
  async __askClusterPermission(data, callerInfo) {
    // every 20 seconds one process get permission to do election
    if (
      (!this.clusterPermissions[data?.key])
      || (Date.now() - this.clusterPermissions[data?.key] > data.expireTime)
    ) {
      this.clusterPermissions[data?.key] = Date.now()
      return true
    } else
      return false;
  }

  /**
   * assign a task to caller process
   * @param data
   * @param data.taskId - ID of task for assign to caller
   * @param callerInfo
   * @param callerInfo.pid - process ID of caller
   * @param callerInfo.uid - unique id of call
   * @returns {Promise<string>}
   * @private
   */
  @ipcMethod(IpcMethods.AssignTask)
  async __assignTaskToProcess(data, callerInfo) {
    if (Object.keys(this.clustersPids).length < 1)
      throw {message: "No any online cluster"}
    this.assignTaskToProcess(data?.taskId, callerInfo.pid);
    return 'Ok';
  }

  /**
   *
   * @param data {Object}         - remote call arguments
   * @param data.peer {String}    - PeerID of remote peer
   * @param data.method {String}  - method to call
   * @param data.params {Object}  - remote method arguments
   * @param data.options {Object} - remote call options
   * @returns {Promise<[any]>}
   * @private
   */
  @ipcMethod(IpcMethods.RemoteCall)
  async __onRemoteCallRequest(data) {
    // console.log(`NetworkIpcHandler.__onRemoteCallRequest`, data);
    const peer = await this.findPeer(data?.peer);
    if(!peer) {
      log(`trying to call offline node %o`, data)
      throw `peer not found peerId: ${data?.peer}`
    }
    return await this.remoteCall(peer, "exec-ipc-remote-call", data, data?.options);
  }

  @ipcMethod(IpcMethods.GetPeerInfo)
  async __getPeerInfo(data): Promise<JsonPeerInfo|null> {
    let peerInfo:PeerInfo|null = await this.findPeer(data?.peerId);
    if(!peerInfo)
      return null
    return {
      id: peerInfo.id.toString(),
      multiaddrs: peerInfo.multiaddrs.map(ma => ma.toString()),
      protocols: peerInfo.protocols
    }
  }

  @ipcMethod(IpcMethods.GetPeerInfoLight)
  async __getPeerInfoLight(data): Promise<JsonPeerInfo|null> {
    let peerInfo:PeerInfo|null = await this.findPeerLocal(data?.peerId);
    if(!peerInfo)
      return null
    return {
      id: peerInfo.id.toString(),
      multiaddrs: peerInfo.multiaddrs.map(ma => ma.toString()),
      protocols: peerInfo.protocols
    }
  }

  @ipcMethod(IpcMethods.GetClosestPeer)
  async __getClosestPeer(data:{peerId?: string, cid?: string}): Promise<JsonPeerInfo[]> {
    let {peerId, cid} = data ?? {}
    if(!!peerId) {
      /** return all bootstrap nodes info */
      let bootstrapList: any[] = this.network.configs.net.bootstrap ?? [];
      bootstrapList = bootstrapList
        .map(ma => ({
          peerId: ma.split('p2p/')[1],
          multiaddr: ma
        }))
        /** exclude self address */
        // .filter(({peerId}) => !!peerId && peerId !== process.env.PEER_ID)

      let peerInfos = await Promise.all(bootstrapList.map(bs => {
        return this.findPeerLocal(bs.peerId)
      }))
      return peerInfos
        .filter(p => !!p)
        .map(peerInfo => ({
            id: peerInfo!.id.toString(),
            multiaddrs: peerInfo!.multiaddrs.map(ma => ma.toString()),
            protocols: peerInfo!.protocols
          })
        )
    }
    /** cid not supported yet */
    return []
  }

  @ipcMethod(IpcMethods.ContentRoutingProvide)
  async __contentRoutingProvide(cids: string | string[], callerInfo) {
    await this.contentPlugin.provide(cids);
  }

  @ipcMethod(IpcMethods.ContentRoutingFind)
  async __onContentRoutingFind(cid: string, callerInfo) {
    return this.contentPlugin.find(cid);
  }

  @ipcMethod(IpcMethods.ForwardGatewayRequest)
  async __forwardGateWayRequest(data: {id: string, requestData: Object, appTimeout: number}) {
    // console.log(`NetworkIpcHandler.__forwardGateWayRequest`, data);
    const nodeInfo = this.collateralPlugin.getNodeInfo(data.id)
    if(!nodeInfo) {
      throw `Unknown id ${data.id}`
    }
    const peer = await this.findPeer(nodeInfo.peerId);

    const timeout = data.appTimeout || 35000
    return await this.remoteCall(peer, RemoteMethods.ExecGateWayRequest, data.requestData, {timeout});
  }

  @ipcMethod(IpcMethods.GetCurrentNodeInfo)
  async __onGetCurrentNodeInfo() {
    await this.collateralPlugin.waitToLoad();
    return this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!);
  }

  @ipcMethod(IpcMethods.AllowRemoteCallByShieldNode)
  async __allowRemoteCallByShieldNode(data: {method: string, options: any}) {
    this.remoteCallPlugin.allowCallByShieldNode(data.method, data.options)
    return true
  }

  @ipcMethod(IpcMethods.IsCurrentNodeInNetwork)
  async __isCurrentNodeInNetwork() {
    await this.collateralPlugin.waitToLoad();
    const currentNodeInfo = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)
    return !!currentNodeInfo;
  }

  @ipcMethod(IpcMethods.GetUptime)
  async __getUptime() {
    const sec_num = Math.floor(process.uptime()); // don't forget the second param
    let hours   = Math.floor(sec_num / 3600);
    let minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    let seconds = sec_num - (hours * 3600) - (minutes * 60);

    // @ts-ignore
    if (hours   < 10) {hours   = "0"+hours;}
    // @ts-ignore
    if (minutes < 10) {minutes = "0"+minutes;}
    // @ts-ignore
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours+':'+minutes+':'+seconds;
  }

  @ipcMethod(IpcMethods.FindNOnlinePeer)
  async __findNOnlinePeer(data: {peerIds: string[], count: number, options?: any}) {
    let {peerIds, count, options} = data;
    return await this.collateralPlugin.findNOnline(peerIds, count, options)
  }

  @ipcMethod(IpcMethods.GetConnectedPeerIds)
  async __getConnectedPeerIds() {
    return await this.collateralPlugin.getConnectedPeerIds()
  }

  /** ==================== remote methods ===========================*/


  /**
   *
   * @param data {Object}
   * @param data.peer {string}
   * @param data.method {string}
   * @param data.params {Object}
   * @param data.options {Object}
   * @param data.options.timeout {number}
   * @param data.options.timeoutMessage {string}
   * @param data.options.taskId {string}
   * @param callerInfo
   * @returns {Promise<*>}
   * @private
   */
  @remoteMethod(RemoteMethods.ExecIpcRemoteCall)
  async __onIpcRemoteCallExec(data, callerInfo) {
    // console.log(`NetworkIpcHandler.__onIpcRemoteCallExec`, data);
    let taskId, options: IpcCallOptions = {};
    if (data?.options?.taskId) {
      taskId = data?.options.taskId;
      if (tasksCache.has(taskId)) {
        options.pid = tasksCache.get(data.options.taskId);
      } else {
        options.pid = this.takeRandomProcess()
        this.assignTaskToProcess(taskId, options.pid);
      }
    }
    // @ts-ignore
    return await CoreIpc.forwardRemoteCall(data, _.omit(callerInfo, ['peer']), options);
  }

  @remoteMethod(RemoteMethods.ExecGateWayRequest)
  async __execGatewayRequest(data, callerInfo) {
    // console.log(`NetworkIpcHandler.__execGatewayRequest`, data)
    return await requestQueue.send(data)
  }
}

export default NetworkIpcHandler;
