export type RemoteCallConfig = {
    timeout?: number,
    timeoutMessage?: string,
    pid?: number
}

export type IpcCallConfig = {
    request?: RemoteCallConfig
}

/**
 * Redis server configs
 * read more https://www.npmjs.com/package/redis/v/3.1.2#:~:text=options%2C%20if%20required.-,options,-object%20properties
 */
export type MessageBusConfigs = {
    /** IP address of the Redis server */
    host?: string,
    /**  */
    port?: number|string,
    /** The UNIX socket string of the Redis server */
    path?: string,
    /** The URL of the Redis server. Format: [redis[s]:]//[[user][:password@]][host][:port][/db-number][?db=db-number[&password=bar[&option=value]]] */
    url?: string,
    /** If set, client will run Redis auth command on connect. Alias auth_pass Note Node Redis < 2.5 must use auth_pass */
    password?: string,
    /** The ACL user (only valid when password is set) */
    user?: string,
}
