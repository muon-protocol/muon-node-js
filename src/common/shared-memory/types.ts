
export type SharedMemActionType = 'SET' | "GET" | 'CLEAR'

export type MemoryRequest = {
    action: SharedMemActionType,
    key: string,
    value: any,
    ttl: number
}
