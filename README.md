<div align="center">
  <a href="https://www.muon.net/" target="_blank">
    <img src="https://assets.website-files.com/614c6fa0cc868403c37c5e53/614c6fa0cc8684353e7c5e63_muon-logo.svg" alt="Logo" width="302" height="80">
  </a>
</div>

<div align="center">
  
## About
[Muon](https://muon.net) is an innovative decentralized oracle network (DON) that enables dApps to make their off-chain components decentralized.
<br>
This repository contains the nodejs implementation of the node in Muon [threshold network](https://docs.muon.net/muon-network/architecture/threshold-network). 
<br>
The core node is run by node operators who participate in a decentralized oracle network.
//todo 
//explain more about this source code

  
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
//todo running node in docker and outside docker( explain all commands with npm i )
//if node is supposed to run on alice use docker
//if node is run for develop use docker or node
//network: local/alice

<a name="getting-started"></a>
## Getting Started
<a name="prerequisites"></a>
### Minimum Requirement

To run a Muon node on your local machine, you need to first install [Redis](https://redis.com) and [MongoDB](https://www.mongodb.com/).
Additionally you will need A Linux server with 4 GB of RAM, dual-core CPU, 20GB of storage space. 

### Joining Muon Network
If you want to run a node and join the muon network read 
[this document](https://docs.muon.net/muon-network/muon-nodes/joining-alice-testnet).



### Cloning this Repository
Because of containing submodule, add the `--recurse-submodules` flag to the `clone`/`pull` commands.

    $ git clone git@github.com:muon-protocol/muon-node-js.git --recurse-submodules
    $ cd muon-node-js
    $ git checkout testnet
    
The next step is to install required node modules as follows:
    
    $ npm install
        
//todo run local node or local network    
### Runing local node
To run this project execute following command:

    $ env-cmd ts-node index.js
    
or if you want to run project with a custom env file:

    $ env-cmd -f ./1.env ts-node index.js


#### Auto-Update
Enabling auto-update will trigger an update and restart the server for any commit made to the repository. To enable auto-update, run the following command: 

    bash ./scripts/auto-update.sh -a setup -p '<PM2_APP_NAME|PM2_APP_ID>'


## Run a local testnet

You can execute the following command to run a local testnet on port 8080.

//todo what happens to network parameters like n and t when using this command

    docker-compose build --build-arg INFURA_PROJECT_ID=< your infura project id >
    docker-compose up

To check local testnet open `http://localhost:8080/v1/?app=tss&method=test` in your browser.

After any changes, you will need to build again.

## Develop MUON app
A Muon app refers to an oracle app that is deployed and runs on the Muon network to fetch and process data and generate an output that can be fed to a smart contract reliably.

To learn more about how to build a Muon app, please refer to [this document](https://dev.muon.net/).

To run a local network to test and develop your Muon apps, first make sure you have installed Mongodb and Redis, 
then use following commands:
<br/>
<br/>
Generate a network with 10 nodes and tss threshold of 2.

    npm run devnet-init -- -t=2 -n=10 -infura=<your-infura-project-id>
    
This command generates .env files inside `/devnet/nodes` directory 
to run a dev network.
    
Then run following command to run devnet.
following command runs a network with 3 nodes and any 2 of 3 nodes can sign the request.



    npm run devnet-run -- -n=3

## Support


Muon has an active and continuously expanding community. 
Discord serves as the primary communication channel for day-to-day interactions and addressing development-related inquiries. 
You can ask your development related questions in dev-help channel.

Join our [Discord server](https://discord.com/invite/rcK4p8g7Ce)

