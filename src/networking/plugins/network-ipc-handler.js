const CallablePlugin = require('./base/callable-plugin')
const {remoteApp, remoteMethod, ipcMethod} = require('./base/app-decorators')
const {timeout} = require('@src/utils/helpers')
const NodeCache = require('node-cache');
const { call: coreIpcCall, broadcast: coreIpcForwardBroadcast } = require('../../core/ipc')

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
  async __onIpcCallTest(data={}) {
    // console.log(`NetworkIpcHandler.__onIpcCallTest`, data)
    const collateralPlugin = this.network.getPlugin('collateral');
    await collateralPlugin.waitToLoad();

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
    return await coreIpcForwardBroadcast({
      data,
      callerInfo: {
        wallet: callerInfo.wallet,
        peerId: callerInfo.peerId._idB58String
      }
    })
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
    tasksCache.set(data.taskId, callerInfo.pid)
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
    let taskId, needTaskAssign = false, options = {};
    if(data.options?.taskId){
      taskId = data.options.taskId;
      if(tasksCache.has(taskId)) {
        options.pid = tasksCache.get(data.options.taskId);
      }
      else{
        needTaskAssign = true;
      }
    }
    const response = await coreIpcCall(
      "forward-remote-call",
      {
        data,
        callerInfo: {
          wallet: callerInfo.wallet,
          peerId: callerInfo.peerId._idB58String
        }
      },
      options);

    if(needTaskAssign){
      console.log({
        needTaskAssign,
        data,
        response
      })
    }

    return response;
  }
}

module.exports = NetworkIpcHandler;
