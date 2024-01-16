export type GatewayCallMode = 'sign' | 'view'

export type GatewayCallParams = {
    app: string,
    method: string,
    params?: any,
    nSign?: number,
    mode?: GatewayCallMode,
    callId?: string,
    gwSign?: boolean,
    fee?: {
        spender: string,
        timestamp: number,
        signature: string,
    }
}
