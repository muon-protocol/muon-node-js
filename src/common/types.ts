export type RemoteCallOptions = {
}

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
    wallet: string,
    peerId: string,
    peer?: any
}
