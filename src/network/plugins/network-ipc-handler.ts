import CallablePlugin from './base/callable-plugin.js'
// import {PeerInfo} from "@libp2p/interface-peer-info";
import { PeerInfo } from '@libp2p/interface/peer-info'
import {remoteApp, remoteMethod, ipcMethod} from './base/app-decorators.js'
import {AppContext, AppRequest, IpcCallOptions, JsonPeerInfo, MuonNodeInfo} from "../../common/types";
import NodeManagerPlugin, {NodeFilterOptions} from "./node-manager.js";
import {MessagePublisher, MessageBusConfigs} from "../../common/message-bus/index.js";
import _ from 'lodash';
import RemoteCall from "./remote-call.js";
import {parseBool, timeout} from '../../utils/helpers.js'
import NodeCache from 'node-cache'
import * as CoreIpc from '../../core/ipc.js'
import {logger} from '@libp2p/logger'
import {isPrivate} from "../utils.js";
import {GatewayCallParams} from "../../gateway/types";
import LatencyCheckPlugin from "./latency-check.js";
import {MapOf} from "../../common/mpc/types";
import {enqueueAppRequest} from "../../core/ipc.js";

class AggregatorBus extends MessagePublisher {
  async send(message:any){
    this.sendRedis.publish(this.busName, JSON.stringify(message));
  }
}

const REQUESTS_PUB_SUB_REDIS = process.env.REQUESTS_PUB_SUB_REDIS;
const REQUESTS_PUB_SUB_CHANNEL = process.env.REQUESTS_PUB_SUB_CHANNEL;
let reqAggregatorBus;

/** enable requests PubSub channel to be used in explorer  */
if(!!REQUESTS_PUB_SUB_CHANNEL) {
  let configs: MessageBusConfigs = {}
  /** set to external redis server */
  if(!!REQUESTS_PUB_SUB_REDIS) {
    configs = {
      host: undefined,
      port: undefined,
      url: REQUESTS_PUB_SUB_REDIS
    }
  }
  reqAggregatorBus = new AggregatorBus(REQUESTS_PUB_SUB_CHANNEL, configs)
}

const log = logger('muon:network:plugins:ipc-handler')

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
  GetNetworkConfig: "get-net-conf",
  GetNodeManagerData: "get-node-manager-data",
  ReportClusterStatus: "report-cluster-status",
  AskClusterPermission: "ask-cluster-permission",
  AssignTask: "assign-task",
  ForwardCoreRemoteCall: "forward-core-remote-call",
  GetPeerInfo: "GPI",
  //GetPeerInfoLight: "GPILight",
  ForwardGatewayRequest: "forward-gateway-request",
  GetCurrentNodeInfo: "get-current-node-info",
  IsCurrentNodeInNetwork: "is-current-node-in-network",
  GetUptime: "get-uptime",
  FindNOnlinePeer: "FNOP",
  GetNodeMultiAddress: "GNMA",
  SendToAggregatorNode: "send-to-aggregator-node",
  AddContextToLatencyCheck: "add-context-to-latency-check",
  GetAppLatency: "get-app-latency",
  IsNodeOnline: "is-node-online",
} as const;

export const RemoteMethods = {
  ExecCoreRemoteCall: "exec-core-remote-call",
  ForwardGateWayRequest: 'forward-gateway-request',
  AggregateData: "aggregate-data",
}

type IpcKeys = keyof typeof IpcMethods;
export type NetworkIpcMethod = typeof IpcMethods[IpcKeys];

@remoteApp
class NetworkIpcHandler extends CallablePlugin {

  clustersPids: { [pid: string]: number } = {};

  async onStart() {
    await super.onStart()
  }

  get nodeManager(): NodeManagerPlugin {
    return this.network.getPlugin('node-manager');
  }

  get remoteCallPlugin(): RemoteCall {
    return this.network.getPlugin('remote-call');
  }

  get latencyCheckPlugin(): LatencyCheckPlugin {
    return this.network.getPlugin('latency');
  }

  get RemoteCallExecEndPoint(): string {
    return this.remoteMethodEndpoint(RemoteMethods.ExecCoreRemoteCall);
  }

  /**
   * @private
   * @ returns {Promise<MuonNodeInfo[]>} - Filter and get nodes list
   */
  @ipcMethod(IpcMethods.FilterNodes)
  async __filterNodes(filter: NodeFilterOptions): Promise<MuonNodeInfo[]> {
    return this.nodeManager.filterNodes(filter)
      .map(({id, active, staker, wallet, peerId, tier, roles, isDeployer}) => ({id, active, staker, wallet, peerId, tier, roles, isDeployer}));
  }

  @ipcMethod(IpcMethods.GetNetworkConfig)
  async __getNetworkConfig() {
    return this.network.configs.net
  }

  @ipcMethod(IpcMethods.GetNodeManagerData)
  async __onIpcGetNodeManagerData(data = {}, callerInfo) {
    return {
      contract: this.network.configs.net.nodeManager,
      nodesList: await this.nodeManager.getNodesList(),
    }
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
    let {pid, status} = data
    switch (status) {
      case "start":
        this.clustersPids[pid] = pid
        break;
      case "exit":
        delete this.clustersPids[pid];
        for(const [key, data] of Object.entries(this.clusterPermissions)) {
          if(data.pid === pid)
            delete this.clusterPermissions[key];
        }
        break;
    }
  }

  clusterPermissions: MapOf<{pid: number, time: number}> = {};

  @ipcMethod(IpcMethods.AskClusterPermission)
  async __askClusterPermission(data: {key: string, pid: number, expireTime?: number}, callerInfo) {
    const {key, pid, expireTime=Infinity} = data
    // every 20 seconds one process get permission to do election
    if (
      (!this.clusterPermissions[key])
      || (Date.now() - this.clusterPermissions[key].time > expireTime)
    ) {
      this.clusterPermissions[key] = {
        pid,
        time: Date.now()
      }
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
  @ipcMethod(IpcMethods.ForwardCoreRemoteCall)
  async __forwardCoreRemoteCall(data) {
    const peer = await this.findPeer(data?.peer);
    if(!peer) {
      log(`trying to call offline node %o`, data)
      throw `peer not found peerId: ${data?.peer}`
    }
    return await this.remoteCall(peer, RemoteMethods.ExecCoreRemoteCall, data, data?.options);
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

  @ipcMethod(IpcMethods.ForwardGatewayRequest)
  async __ipcForwardGateWayRequest(data: {requestData: GatewayCallParams, appTimeout: number}) {
    return this.__rcForwardGatewayRequest(data.requestData, this.nodeManager.currentNodeInfo, {timeout: 30000})
  }

  private async forwardGatewayRequestToOnlinePartner(partners: string[], requestData: GatewayCallParams, timeout?:number) {
    const n = partners.length;
    const candidatePartners = _.shuffle(partners).slice(0, Math.ceil(n/2));
    const onlines: string[] = await this.nodeManager.findNOnline(candidatePartners, 1, {timeout: 5000, forceNOnline: true});
    if(onlines.length < 1)
      throw `The request cannot be forwarded because there is no online partner`;
    return this.forwardGatewayCallToOtherNode(
      onlines[0],
      requestData,
      timeout,
    )
  }

  private async forwardGatewayCallToOtherNode(nodeId: string, requestData: GatewayCallParams, timeout?: number) {
    log(`forwarding the request to the node. %o`, {target: nodeId, requestData})
    const nodeInfo = this.nodeManager.getNodeInfo(nodeId)
    if(!nodeInfo) {
      throw `Unknown id ${nodeId}`
    }
    const peer = await this.findPeer(nodeInfo.peerId);
    return await this.remoteCall(peer, RemoteMethods.ForwardGateWayRequest, requestData, {timeout});
  }

  @ipcMethod(IpcMethods.GetCurrentNodeInfo)
  async __onGetCurrentNodeInfo() {
    return this.nodeManager.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!);
  }

  @ipcMethod(IpcMethods.IsCurrentNodeInNetwork)
  async __isCurrentNodeInNetwork(): Promise<boolean> {
    const currentNodeInfo = this.nodeManager.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)
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
  async __findNOnlinePeer(data: {searchList: string[], count: number, options?: any}) {
    let {searchList, count, options} = data;
    return await this.nodeManager.findNOnline(searchList, count, options)
  }

  @ipcMethod(IpcMethods.GetNodeMultiAddress)
  async __getNodeMultiAddress() {
    let multiAddrs = this.network.libp2p.components.addressManager.getAddresses()
    let allowPrivateIps = parseBool(process.env.DISABLE_ANNOUNCE_FILTER!)
    if (!allowPrivateIps)
      multiAddrs = multiAddrs.filter(ma => !isPrivate(ma))
    return multiAddrs.map(ma => ma.toString())
  }

  /**
   *
   * @param type {string} - type of data.
   * @param data - data to be stored on node.
   * @returns {Promise<string[]>} - The ID of the nodes that received the data.
   */
  @ipcMethod(IpcMethods.SendToAggregatorNode)
  async __sendToAggregatorNode(data: {type: string, data: any}): Promise<string[]> {
    let aggregators = this.network.configs.net.nodes?.aggregators || []
    if(aggregators.length > 0) {
      const aggregatorsInfo = this.nodeManager.filterNodes({list: aggregators});
      let responses: (MuonNodeInfo|null)[] = await Promise.all(
        aggregatorsInfo.map(n => {
          if(n.wallet === process.env.SIGN_WALLET_ADDRESS) {
            return this.__aggregateData(data, this.nodeManager.currentNodeInfo!)
              .then(() => n)
              .catch(e => {
                log.error("SendToAggregatorNode:ex, %O", e);
                return null;
              })
          }
          else {
            return this.findPeer(n.peerId)
              .then(peer => {
                if(!peer)
                  throw `peer not found`
                return this.remoteCall(
                    peer,
                    RemoteMethods.AggregateData,
                    data
                  )
                }
              )
              .then(() => n)
              .catch(e => {
                log.error("SendToAggregatorNode:ex %O", e);
                return null;
              })
          }
        })
      );
      return responses.filter(n => !!n).map(n => n!.id)
    }
    return []
  }

  @ipcMethod(IpcMethods.AddContextToLatencyCheck)
  async __addContextToLatencyCheck(context: AppContext) {
    return this.latencyCheckPlugin.initAppContext(context);
  }

  @ipcMethod(IpcMethods.GetAppLatency)
  async __getAppLatency(data: {appId: string, seed: string}) {
    const {appId, seed} = data;
    return this.latencyCheckPlugin.getAppLatency(appId, seed)
  }

  @ipcMethod(IpcMethods.IsNodeOnline)
  async __isNodeOnline(node: string) {
    return this.nodeManager.isNodeOnline(node);
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
  @remoteMethod(RemoteMethods.ExecCoreRemoteCall)
  async __execCoreRemoteCall(data, callerInfo) {
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
    return await CoreIpc.execRemoteCall(data, _.omit(callerInfo, ['peer']), options);
  }

  @remoteMethod(RemoteMethods.ForwardGateWayRequest)
  async __rcForwardGatewayRequest(requestData: GatewayCallParams, callerInfo, options:{timeout?: number}={}) {
    let {app} = requestData

    const currentNode: MuonNodeInfo|undefined = this.nodeManager.currentNodeInfo;

    /** If current node is not in the network */
    if(!currentNode) {
      const deployers:string[] = this.nodeManager.filterNodes({isDeployer: true}).map(n => n.id);
      const onlineList: string[] = await this.nodeManager.findNOnline(
        _.shuffle(deployers).slice(0, Math.ceil(deployers.length/2)),
        1,
        {timeout: 2000},
      )
      if(onlineList.length <= 0)
        throw `no online deployer to forward the request`;
      return this.forwardGatewayCallToOtherNode(onlineList[0], requestData, options.timeout);
    }

    const context: AppContext|undefined = await CoreIpc.getAppOldestContext(app);
    if(context) {
      let partners = context.party.partners;
      if(!!context.deploymentRequest?.data?.init?.key?.shareProofs) {
        partners = Object.keys(context.deploymentRequest?.data?.init?.key?.shareProofs);
      }
      /** When the context exists, the node can either process it or send it to the appropriate node. */
      if(partners.includes(currentNode.id)) {
        /** Process the request */
        return await enqueueAppRequest(requestData)
      }
      else {
        /** Forward request to the appropriate node. */
        const candidatePartners = _.shuffle(partners).slice(0, Math.ceil(partners.length/2));
        /** find an online node that has the app's tss key */
        const availables: string[] = await CoreIpc.findNAvailablePartners({
          nodes: candidatePartners,
          count: 1,
          partyInfo: {appId:context.appId, seed: context.seed},
          resolveAnyway: true,
          checkFrostNonce: true,
        });
        if(availables.length <= 0)
          throw "The request cannot be forwarded because there is no available partner";
        return this.forwardGatewayCallToOtherNode(availables[0], requestData, options.timeout);
      }
    }
    else {
      if(currentNode.isDeployer) {
        if(app === 'deployment') {
          /**
           * If deployment context is not exist, it means that genesis key is not initialized.
           * Two steps are required need to do:
           * 1) initialize genesis key (calling deployment app init method)
           * 2) deploy the `deployment` app itself using genesis key.
           * */
          throw `Genesis key not initialized`
        }
        else {
          /**
           The deployer node should contain all the contexts.
           If it lacks any context, it means that the context does not exist at all.
           */
          throw `App's context not found.`
        }
      }
      else if(!callerInfo.isDeployer) {
        /**
         If a non-deployer node does not have a context, it should send the request to one of the deployer nodes.
         The deployer nodes know the members of the app party and can forward the request to the suitable one.
         */
        let deployers: string[] = this.nodeManager.filterNodes({isDeployer: true}).map(({id}) => id);
        return this.forwardGatewayRequestToOnlinePartner(deployers, requestData, options.timeout);
      }
      else {
        /**
         * If the request is forwarded from a deployer and it is missed, throw an error.
         */
        throw `App's context not found.`
      }
    }
  }

  @remoteMethod(RemoteMethods.AggregateData)
  async __aggregateData(data: {type: string, data: AppRequest}, callerInfo: MuonNodeInfo) {
    /** validating data */
    switch (data.type) {
      case "AppRequest": {
        let appName = data?.data?.app;
        if(!appName)
          throw 'invalid request'
        /** forward request into core to be verified and then be stored */

        // TODO: Uncomment this
        // Just deployer nodes have access to all appContexts
        // at the momemnt and monitoring nodes can't verify
        // the transactions.
        // It should be changed to let all nodes query the AppContext w/o
        // the party and get the TSS pubkey and verify the requests

        //const verified = await CoreIpc.verifyRequestSignature(data.data)

        //if(!verified)
        //  throw 'request not verified';
        if(reqAggregatorBus) {
          await reqAggregatorBus.send(data.data);
        }
        break;
      }
      default:
        throw 'invalid type'
    }
  }
}

export default NetworkIpcHandler;
