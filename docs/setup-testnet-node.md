# Setup a Muon Testnet node


## 1) Install and Run the Muon Node

### Clone the repository

```
git clone https://github.com/muon-protocol/muon-node-js.git --recurse-submodules --branch testnet
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
PEER_ID = QmeS4VP6o4HvkDGAA5Mzwxidas1Pq6cTZvtDpg88qsEumw
SIGN_WALLET_ADDRESS = 0x587000cB548f1e88b8977b417F3DF562A76F8cC9
```

The value of these two variables will be added to the staking contract in the last step.

## 2) Add the node to the network

### Get some MuonTest ($MU-TEST) token

The [test token](https://mumbai.polygonscan.com/address/0xb6ba20951acd0b5bd092e61052c54d3f783d1008#code) is deployed on the Ploygon test network at `0xb6ba20951acd0b5bd092e61052c54d3f783d1008`. Use the `mint` function of the token contract to get at least 1000 $MU-TEST tokens.

ⓘ The token has 18 decimal places so you should use `1000000000000000000000` as parameter for `mint` or following functions.

### Approve staking contract to use your tokens

Use the `approve` function of the [token contract](https://mumbai.polygonscan.com/address/0xb6ba20951acd0b5bd092e61052c54d3f783d1008#code) to approve staking contract at `0xb80d30686B69cefF364Bd152a57Cac5fd7053539` to stake your test tokens.

### Add the node on MuonNodesStaking contract

Add your node to the test network by calling the `addMuonNode` function on the [staking contract](https://mumbai.polygonscan.com/address/0xb80d30686B69cefF364Bd152a57Cac5fd7053539#writeContract) with the `PEER_ID` and `SIGN_WALLET_ADDRESS` of your node.

`intialStakeAmount` is the amount of the tokens that you want to stake for running your node. Minimum amount is 1000 tokens.

You can stake more later using the `stakeMore` function. The rewards will be distributed based on the total staked amounts.

After above steps, the node will be running and the gateway will be visible on `http://your-ip:8000/v1/`
