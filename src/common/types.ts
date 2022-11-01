export type RemoteCallOptions = {
}

export type Constructor<T> = new (...args: any[]) => T;

export type IpcCallOptions = {
    /**
     * If response not receive after this timeout, call result will reject.
     */
    timeout?: number,
    /**
     * Define error message for timeout promise rejection.
     */
    timeoutMessage?: string,
    /**
     * Define cluster PID to running ipc method.
     * If defined, call will forward to specified core cluster process.
     */
    pid?: number
}

export type MuonNodeInfo = {
    id: string,
    wallet: string,
    peerId: string,
    isOnline?: boolean,
    peer?: any
}

export type AppDeploymentStatus = {
    appId: string,
    /** Is app deployed? */
    deployed: boolean,
    /** reqId of confirmed deployment request signed by global tss group */
    reqId?: string,
    /** context version */
    version?: number,
    /** hash of context */
    contextHash?: string,
};
