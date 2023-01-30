import { JSONPeerId } from 'peer-id'
import {PeerInfo} from "@libp2p/interface-peer-info";
export { PeerId, isPeerId } from '@libp2p/interface-peer-id';
import { Peer } from '@libp2p/interface-peer-store';

export type Libp2pPeerInfo = PeerInfo
export type Libp2pPeer = Peer;

export interface INetworkPlugin {

    new(network: any, configs: any): INetworkPlugin;

    constructor(network: any, configs: any): INetworkPlugin;

    /**
     * Run immediately after plugin construction
     */
    onInit(): void;

    /**
     * Run after libp2p start successfully
     */
    onStart(): void;
}

export type Libp2pConfig = {
    peerId: JSONPeerId,
    natIp?: string,
    host: string,
    port: string | number,
    bootstrap?: string[]
}

export type NetworkConfig = {
    libp2p: Libp2pConfig,
    plugins: {[index: string]: [INetworkPlugin, any]},
    net: {
        tss: {
            threshold: number,
            max: number,
        },
        nodeManager: {
            network: string,
            address: string
        }
    },
    tss: {
        party: {
            id: string
            t: number,
            max: number
        },
        key: {
            id: string,
            share: string,
            publicKey: string,
            address: string
        }
    }
}
