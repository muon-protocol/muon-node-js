<div align="center">
  <a href="https://www.muon.net/" target="_blank">
    <img src="https://assets.website-files.com/614c6fa0cc868403c37c5e53/614c6fa0cc8684353e7c5e63_muon-logo.svg" alt="Logo" width="302" height="80">
  </a>
</div>

<div align="center">
  
## About
[Muon](https://muon.net) is an innovative decentralized oracle network (DON) that enables dApps to make their off-chain components decentralized.
<br>
This repository contains the nodejs implementation of the node in Muon [Threshold Network](https://docs.muon.net/muon-network/architecture/threshold-network). 
<br>
The core node is run by node operators who participate in a decentralized oracle network.
You can also use core node to run a local devnet to develop your own Muon apps.

  
<br />
<br />


<a href="https://github.com/muon-protocol/muon-node-js/issues/new?assignees=&labels=bug&template=01_BUG_REPORT.md&title=bug%3A+">Report a Bug</a>
·
<a href="https://github.com/muon-protocol/muon-node-js/issues/new?assignees=&labels=enhancement&template=02_FEATURE_REQUEST.md&title=feat%3A+">Request a Feature</a>
.
<a href="https://github.com/muon-protocol/muon-node-js/discussions">Ask a Question</a>
</div>

<div align="center">

[![](https://img.shields.io/badge/Discord-Join_Chat-blue.svg)](https://discord.com/invite/rcK4p8g7Ce)
[![](https://img.shields.io/badge/Documents-Development-blue.svg)](https://dev.muon.net/)
[![](https://img.shields.io/badge/Git_Book-Muon_network-blue.svg)](https://docs.muon.net/muon-network/)

</div>

//what are different use cases
//1 run node on alice: link to dev docs
//2 (not required) run local network with docker 
//if possible to develop muon app (do not use git clone commands) 
//3 run network on local node outside docker(npmi and clone...)
 
//if user is gonna test its muon app its better to run network on docker if possible
//running node in docker and outside docker( explain all commands with npm i )
//if node is supposed to run on alice use docker
//if node is run for develop use docker or node
//network: local/alice

<a name="getting-started"></a>
## Getting Started
<a name="prerequisites"></a>
### Minimum Requirement

To run a Muon node on your local machine, you need to first install [Redis](https://redis.com) and [MongoDB](https://www.mongodb.com/).
Additionally you will need A Linux server with 4 GB of RAM, dual-core CPU, 20GB of storage space. 

### Joining Alice Testnet
If you want to run a node and join the Alice testnet read 
[this document](https://docs.muon.net/muon-network/muon-nodes/joining-alice-testnet).



### Cloning this Repository
Clone Muon node’s repository and checkout the `testnet` branch through the following command:

    $ git clone git@github.com:muon-protocol/muon-node-js.git --recurse-submodules
    $ cd muon-node-js
    $ git checkout testnet
    
Because of containing submodule, add the `--recurse-submodules` flag to the `clone`/`pull` commands.  
The next step is to install required node modules as follows:
    
    $ npm install
        

## Run a local devnet

To run a local devnet to test and develop your Muon apps 
follow these steps:
<br/>
Generate a network with 10 nodes and tss threshold of 2.

    npm run devnet-init -- -t=2 -n=10 -infura=<your-infura-project-id>
    
This command generates .env files inside `/devnet/nodes` directory 
to run a dev network.
    
Then run following command to run devnet.
This command runs a network with 3 nodes and any 2 of 3 nodes can sign the request.

    npm run devnet-run -- -n=3
    
This command allows you to run all three nodes simultaneously in a single terminal. Alternatively, 
you can run each node separately in a separate terminal using the following command:

    env-cmd ./devnet/nodes/dev-node-1.env ts-node src/index.ts
    

To run other nodes, simply change `dev-node-1.env` to the desired environment file.         

## Develop MUON app
A Muon app refers to an oracle app that is deployed and runs on the Muon network to fetch and process data and generate an output that can be fed to a smart contract reliably.

To learn more about how to build a Muon app, please refer to [this document](https://dev.muon.net/).


## Support
Muon has an active and continuously expanding community.
Discord serves as the primary communication channel for day-to-day interactions and addressing development-related inquiries. 
You can ask your development related questions in dev-help channel.

Join our [Discord server](https://discord.com/invite/rcK4p8g7Ce)

