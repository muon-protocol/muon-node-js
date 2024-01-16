
export type SharedMemActionType = 'SET' | "GET" | "WGET" | "CLEAR"

export type MemoryRequest = {
    action: SharedMemActionType,
    key: string,
    value: any,
    ttl: number,
    timeout: number
}
