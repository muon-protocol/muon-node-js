import BN from 'bn.js'
import {PublicKey} from "../utils/tss/types";
import {MultiPartyComputation} from "./mpc/base";

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

export type RemoteMethodOptions = {
    middlewares?: any[],
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
    isDeployer: boolean
}

/**
 * Apps deployment statuses
 *
 * NEW: app not deployed.
 * TSS_GROUP_SELECTED: App deployed but TSS key not generated.
 * DEPLOYED: App deployed and TSS key generated.
 * PENDING: App deployed and tss key generated but it is about to expire.
 * EXPIRED: App deployment expired and tss key is no longer valid.
 */
export type AppDeploymentStatus = "NEW" | "TSS_GROUP_SELECTED" | "DEPLOYED" | "PENDING" | "EXPIRED";

export type AppDeploymentInfo = {
    appId: string,
    /** app deployment seed */
    seed: string|null,
    /** Is app deployed? */
    deployed: boolean,
    /** Is this context contains the TSS key generation request data */
    hasKeyGenRequest: boolean,
    /** Is this node has the App's TSS key share */
    hasTssKey: boolean,
    /** deployment status*/
    status: AppDeploymentStatus,
    /** reqId of confirmed deployment request signed by deployment tss group */
    reqId?: string,
    /** hash of context */
    contextHash?: string,
};

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
    },
    signature: string,
}

export type AppRequest = {
    confirmed: boolean,
    reqId: string,
    app: string,
    appId: string,
    method: string,
    deploymentSeed: string,
    gwAddress: string,
    data: {
        uid: string,
        params: any,
        timestamp: number,
        result: any,
        resultHash: string,
        signParams: TypedValue[],
        init: {
            nonceAddress: string,
            [key: string]: any,
        },
        fee: {
            /** returned from Fee server */
            amount: number,
            /** comes from client */
            spender: {
                address: string,
                timestamp: number,
                /**
                 * signature of hash of (spender, timestamp, appId)
                 * hash = soliditySha3 (
                 *      {t: "address", v: spender},
                 *      {t: "uint64", v: timestamp},
                 *      {t: "uint256", v: appId},
                 * )
                 */
                signature: string,
            },
            /**
             * returned from fee server
             * signature of hash of (reqId, spender, timestamp, appId, amount)
             * hash = soliditySha3 (
             *      {t: "uint256", v: reqId},
             *      {t: "uint256", v: amount},
             * )
             */
            signature: string,
        },
        [key: string]: any,
    }
    startedAt: number,
    confirmedAt: number,
    signatures: MuonSignature[]
}

export type AppContext = {
    appId: string,
    appName: string,
    previousSeed: string,
    seed: string,
    isBuiltIn?: boolean,
    party: {
        t: number,
        max: number,
        partners: string[]
    },
    rotationEnabled?: boolean,
    ttl?: number,
    pendingPeriod?: number,
    expiration?: number,
    deploymentRequest?: AppRequest,
    keyGenRequest?: AppRequest,
    publicKey?: JsonPublicKey,
    polynomial?: PolynomialInfoJson
}

export type PolynomialInfo = {
    t: number,
    Fx: PublicKey[]
}

export type PolynomialInfoJson = {
    t: number,
    Fx: string[]
}

export type AppTssConfig = {
    appId: string,
    seed: string,
    keyGenRequest: AppRequest,
    publicKey: JsonPublicKey,
    keyShare?: string,
    expiration?: number,
    polynomial?: PolynomialInfoJson
}

export type AppTssPublicInfo = {
    publicKey: string,
    polynomial?: PolynomialInfoJson
}

export type PartyInfo = {
    appId: string,
    seed: string,
    isForReshare?: boolean
}

export type NodeManagerConfigs = {
    /** The NodeManager contract address */
    address: string,
    /** The network that node manager deployed on */
    network: string,
    /** The Pagination contract address */
    pagination?: string
}

export type NetConfigs = {
    tss: {
        threshold: number,
        max: number,
        defaultTTL: number,
        pendingPeriod: number,
    },
    nodeManager: NodeManagerConfigs,
    "routing": {
        "delegate": string[]
    },
    "nodes"?: {
        "onlineList"?: string,
    },
    bootstrap: string[],
    fee?: {
        endpoint: string,
        signers: string[]
    },
    synchronizer: {
        "monitor": {
            "providers": string[],
            "startDelay": number,
            "interval": number
        }
    }
}

export type DeploymentTssConfigs = {
    party: {
        id: string
        t: number,
        max: number
    },
    key: {
        id: string,
        share: string,
        publicKey: string,
        address: string,
        polynomial?: {
            t: number,
            Fx: string[]
        }
    }
}

export type NodeManagerDataRaw = {
    _lastUpdateTime: string,
    _nodes: {
        id: string,
        nodeAddress: string,
        stakerAddress: string,
        peerId: string,
        active: boolean,
        startTime: number,
        endTime: number,
        lastEditTime: number,
        isDeployer: boolean,
    }[]
}

export type NodeManagerData = {
    lastUpdateTime: number,
    nodes: MuonNodeInfo[]
}

export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] }

export type MpcType = "DistributedKeyGeneration" | "KeyRedistribution";

export type MpcInitHandler = (constructData, MpcNetwork) => Promise<MultiPartyComputation>
