export type RemoteCallConfig = {
    timeout?: number,
    timeoutMessage?: string,
    pid?: number
}

export type IpcCallConfig = {
    request?: RemoteCallConfig
}
