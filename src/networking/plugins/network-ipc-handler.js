const CallablePlugin = require('./base/callable-plugin')
const {remoteApp, remoteMethod, ipcMethod} = require('./base/app-decorators')
const {timeout} = require('@src/utils/helpers')
const NodeCache = require('node-cache');
const coreIpc = require('../../core/ipc')

const tasksCache = new NodeCache({
  stdTTL: 6*60, // Keep distributed keys in memory for 6 minutes
  // /**
  //  * (default: 600)
  //  * The period in seconds, as a number, used for the automatic delete check interval.
  //  * 0 = no periodic check.
  //  */
  checkperiod: 60,
  useClones: false,
});

@remoteApp
class NetworkIpcHandler extends CallablePlugin {

  clustersPids = {};

  async onStart() {
    super.onStart()

    this.network.once('peer:connect', async (peerId) => {
      await timeout(5000);
    })
  }

  get collateralPlugin() {
    return this.network.getPlugin('collateral');
  }

  get remoteCallPlugin() {
    return this.network.getPlugin('remote-call');
  }

  @ipcMethod("get-online-peers")
  async __onGetOnlinePeers() {
    return Object.keys(this.collateralPlugin.onlinePeers);
  }

  @ipcMethod("get-collateral-info")
  async __onIpcGetCollateralInfo(data={}, callerInfo) {
    console.log(`NetworkIpcHandler.__onIpcGetCollateralInfo`, data, callerInfo);
    const collateralPlugin = this.network.getPlugin('collateral');
    await collateralPlugin.waitToLoad();
    console.log(`NetworkIpcHandler.__onIpcGetCollateralInfo`, "data is ready", callerInfo);

    let {groupInfo, networkInfo, peersWallet, walletsPeer} = collateralPlugin;
    return {groupInfo, networkInfo, peersWallet, walletsPeer}
  }

  @ipcMethod("broadcast-message")
  async __onBroadcastMessage(data) {
    // console.log("NetworkIpcHandler.__onBroadcastMessage", data);
    this.broadcast(data);
    return "Ok"
  }

  async onBroadcastReceived(data={}, callerInfo) {
    // console.log('NetworkIpcHandler.onBroadcastReceived', data, callerInfo);
    return await coreIpc.broadcast({
      data,
      callerInfo: {
        wallet: callerInfo.wallet,
        peerId: callerInfo.peerId._idB58String
      }
    })
  }

  assignTaskToProcess(taskId, pid) {
    tasksCache.set(taskId, pid)
  }

  takeRandomProcess() {
    let pList = Object.keys(this.clustersPids);
    const index = Math.floor(Math.random() * pList.length)
    return pList[index]
  }

  getTaskProcess(taskId) {
    return tasksCache.get(taskId);
  }

  @ipcMethod('report-cluster-status')
  async __reportClusterStatus(data={}) {
    // console.log("NetworkIpcHandler.__reportClusterStatus", {data,callerInfo});
    let {pid, status} = data
    switch (status) {
      case "start":
        this.clustersPids[pid] = true
        break;
      case "exit":
        delete this.clustersPids[pid];
        break;
    }
    // console.log("NetworkIpcHandler.__reportClusterStatus", this.clustersPids);
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
  @ipcMethod('assign-task')
  async __assignTaskToProcess(data={}, callerInfo) {
    if(Object.keys(this.clustersPids).length < 1)
      throw {message: "No any online cluster"}
    this.assignTaskToProcess(data.taskId, callerInfo.pid);
    return 'Ok';
  }

  @ipcMethod("remote-call")
  async __onRemoteCallRequest(data={}) {
    // console.log(`NetworkIpcHandler.__onRemoteCallRequest`, data);
    const peer = await this.findPeer(data.peer);
    return await this.remoteCall(peer, "exec-ipc-remote-call", data);
  }

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
  @remoteMethod("exec-ipc-remote-call")
  async __onIpcRemoteCallExec(data={}, callerInfo) {
    // console.log(`NetworkIpcHandler.__onIpcRemoteCallExec`, data);
    let taskId, options = {};
    if(data.options?.taskId){
      taskId = data.options.taskId;
      if(tasksCache.has(taskId)) {
        options.pid = tasksCache.get(data.options.taskId);
      }
      else{
        options.pid = this.takeRandomProcess()
        this.assignTaskToProcess(taskId, options.pid);
      }
    }
    return await coreIpc.call(
      "forward-remote-call",
      {
        data,
        callerInfo: {
          wallet: callerInfo.wallet,
          peerId: callerInfo.peerId._idB58String
        }
      },
      options);
  }
}

module.exports = NetworkIpcHandler;
