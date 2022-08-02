export type GatewayCallMode = 'sign' | 'view'

export type GatewayMethodData = {
    app: string,
    method: string,
    params: any,
    nSign?: number,
    mode: GatewayCallMode,
    callId: string,
    gwSign?: boolean
}
