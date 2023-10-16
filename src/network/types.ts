// import {PeerInfo} from "@libp2p/interface-peer-info";
import type { PeerInfo } from '@libp2p/interface/peer-info';

export { PeerId, isPeerId } from '@libp2p/interface-peer-id';
import { Peer } from '@libp2p/interface-peer-store';
import {NetConfigs} from "../common/types";

export type Libp2pPeerInfo = PeerInfo
export type Libp2pPeer = Peer;

export interface INetworkPlugin {

    new(network: any, configs: any): INetworkPlugin;

    constructor(network: any, configs: any): INetworkPlugin;

    /**
     * Executes right away when the plugin is created
     */
    onInit(): void;

    /**
     * Runs after libp2p has started successfully
     */
    onStart(): void;
}

export type Libp2pConfig = {
    peerId: any,
    natIp?: string,
    host: string,
    port: string | number,
    bootstrap?: string[]
}

export type NetworkProcessConfigs = {
    libp2p: Libp2pConfig,
    plugins: {[index: string]: [INetworkPlugin, any]},
    net: NetConfigs,
}
