import {GlobalBroadcastChannels} from "./contantes";
import BN from 'bn.js'

export type JsonPeerInfo = {
    id: string;
    multiaddrs: string[];
    protocols: string[];
}

export type JsonPublicKey = {
    address?: string,
    encoded?: string,
    x: string,
    yParity: string
}

export type RemoteCallOptions = {
}

export type RemoteMethodOptions = {
    allowShieldNode?: boolean,
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
    active: boolean,
    staker: string,
    wallet: string,
    peerId: string,
    isDeployer: boolean,
    isOnline?: boolean
}

export type AppDeploymentStatus = "NEW" | "TSS_GROUP_SELECTED" | "DEPLOYED";

export type AppDeploymentInfo = {
    appId: string,
    /** Is app deployed? */
    deployed: boolean,
    /** deployment status*/
    status: AppDeploymentStatus,
    /** reqId of confirmed deployment request signed by global tss group */
    reqId?: string,
    /** context version */
    version?: number,
    /** hash of context */
    contextHash?: string,
};

type GlobalBroadcastChannelsKeys = keyof typeof GlobalBroadcastChannels;
export type GlobalBroadcastChannel = typeof GlobalBroadcastChannels[GlobalBroadcastChannelsKeys];

export type Override<T1, T2> = Omit<T1, keyof T2> & T2;

export type TypedValue =
  | string
  | number
  | BN
  | { type: string; value: string; }
  | { t: string; v: string | BN | number; }
  | boolean;

export type MuonSignature = {
    owner: string,
    ownerPublicKey: {
        x: string,
        yParity: '0' | '1',
        timestamp: number,
        signature: string,
    }
}

export type AppRequest = {
    confirmed: boolean,
    reqId: string,
    app: string,
    appId: string,
    method: string,
    gwAddress: string,
    data: {
        uid: string,
        params: any,
        timestamp: number,
        result: any,
        signParams: TypedValue[],
        init: {
            nonceAddress: string
        }
    }
    startedAt: number,
    confirmedAt: number,
    signatures: MuonSignature[]
}
