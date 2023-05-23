import process from 'node:process'
import {createLibp2p} from 'libp2p'
import {tcp} from '@libp2p/tcp'
import {noise} from '@chainsafe/libp2p-noise'
import {mplex} from '@libp2p/mplex'
import {multiaddr} from '@multiformats/multiaddr'
import {createFromJSON} from "@libp2p/peer-id-factory";
import {pipe} from "it-pipe";
import {toString as uint8ArrayToString} from "uint8arrays/to-string";
import {fromString as uint8ArrayFromString} from "uint8arrays/from-string";
import axios from "axios"
import * as dotenv from 'dotenv'

dotenv.config();

let nodeResponseLoaded = false;
let nodesResponse = [];

async function loadNodes() {
    axios.get("https://monitor1.muon.net/nodes")
        .then(({data}) => {
            if (data.success) {
                nodeResponseLoaded = true;
                nodesResponse = data.result;
            }
        })
        .catch((e) => {
            console.log("error checkActiveNodes: " + e.message);
            return false;
        });
}

loadNodes();
setInterval(loadNodes, 10 * 60000);

async function getNodeInfo(key, val) {
    while (!nodeResponseLoaded) {
        console.log("Waiting to load nodes info...");
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    for (let i = 0; i < nodesResponse.length; i++)
        if (nodesResponse[i][key] == val)
            return nodesResponse[i];
    return null
}


const chatProtocol = '/muon/network/remote-call/1.0.0';


let dialerPeerId = {
    id: process.env.PEER_ID,
    privKey: process.env.PEER_PRIVATE_KEY,
    pubKey: process.env.PEER_PUBLIC_KEY
};


const peerId = await
createFromJSON(dialerPeerId);

const libp2pClient = await
createLibp2p({
    peerId,
    addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0'],
        // announceFilter: (mas) => []
    },
    transports: [tcp()],
    connectionEncryption: [noise()],
    streamMuxers: [mplex()],
});


await
libp2pClient.start();
console.log('libp2p has started');

const stop = async () => {
    await libp2pClient.stop();
    console.log('libp2p has stopped');
    process.exit(0)
};

export async function call(request) {
    let method = request.method;

    let deployerNodeIps = ["104.131.177.195", "167.71.60.172", "3.130.24.220", "18.221.53.56", "194.195.211.27", "194.195.244.101", "209.250.252.247", "95.179.139.243"];

    let ma;

    if (request.ma)
        ma = request.ma;
    else if (deployerNodeIps.includes(request.ip)) {
        ma = `/ip4/${request.ip}/tcp/5000`;
    } else if (request.ip || request.id) {
        let nodeInfo;
        if (request.ip)
            nodeInfo = await getNodeInfo("ip", request.ip);
        if (request.id)
            nodeInfo = await getNodeInfo("id", request.id);
        if (!nodeInfo)
            throw Error("node info not found");
        ma = `/ip4/${nodeInfo.ip}/tcp/${nodeInfo.networkingPort}`;
    } else {
        //default
        ma = `/ip4/104.131.177.195/tcp/5000`;
    }

    console.log("P2P: " + ma);
    ma = multiaddr(ma);

    let stream;
    try {
        stream = await
            libp2pClient.dialProtocol(ma, chatProtocol);
    } catch (e) {
        return "Error dialProtocol " + e.message;
    }

    let data = {
        callId: "1gnuln3hnjdqtm3" + Math.floor(Math.random() * 1e12).toString(),
        method: "NetworkIpcHandler.exec-ipc-remote-call",
        params: {
            method: method,
            params: request.params
        }
    };

    if (method.includes("NetworkIpcHandler"))
        data = {
            callId: "1gnuln3hnjdqtm3" + Math.floor(Math.random() * 1e12).toString(),
            method: method,
            params: request.params
        };


    let dataStr = JSON.stringify(data);
    return pipe([uint8ArrayFromString(dataStr)], stream, async function (source) {
        for await (const data of source) {
            let jsonResp = JSON.parse(uint8ArrayToString(data.subarray()));
            return jsonResp;
        }
    });
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

