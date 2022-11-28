# Setup a Muon Testnet node


## 1- Install Muon Node

### Clone the repository

```
git clone git@github.com:muon-protocol/muon-node-js.git --recurse-submodules --branch testnet
```

### Build and run docker

```
cd muon-node-js
docker-compose build
docker-compose up -d
```

### Get PeerId and SignWallet address

```
docker exec -it muon-node cat .env| egrep "SIGN_WALLET_ADDRESS|PEER_ID"
```

Output is something like this:

```
PEER_ID=QmeS4VP6o4HvkDGAA5Mzwxidas1Pq6cTZvtDpg88qsEumw
SIGN_WALLET_ADDRESS = 0x587000cB548f1e88b8977b417F3DF562A76F8cC9
```

These 2 fields will be added to the smart contracts in the next steps.

## 2- Add the node to the network

### Get some MuonTest($MU-TEST) token

The test token is on Ploygon test network

https://mumbai.polygonscan.com/address/0xb6ba20951acd0b5bd092e61052c54d3f783d1008#code

### Stake minimum 1000 tokens on MuonNodesStaking contract

https://mumbai.polygonscan.com/address/0x44325D08C455adf634866f8c4cE5035352a745e1#code


```stake``` function.

### Add a node on MuonNodesStaking contract

https://mumbai.polygonscan.com/address/0x44325D08C455adf634866f8c4cE5035352a745e1#code

```addMuonNode``` function.  
nodeAddress is ```SIGN_WALLET_ADDRESS``` on the node configs.  
peerId is ```PEER_ID``` on the node configs.



After above steps, the node will be running and the gateway will be visible on `http://your-ip:8000/v1/`
