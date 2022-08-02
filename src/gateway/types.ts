export type GatewayCallMode = 'sign' | 'view'

export type GatewayMethodData = {
    method: string,
    params: any,
    nSign: number | undefined,
    mode: GatewayCallMode,
    callId: string,
    gwSign: boolean | undefined
}
