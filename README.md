<div align="center">
  <a href="https://www.muon.net/" target="_blank">
    <img src="https://assets.website-files.com/614c6fa0cc868403c37c5e53/614c6fa0cc8684353e7c5e63_muon-logo.svg" alt="Logo" width="302" height="80">
  </a>
</div>
<br/>
<div align="center">

[![](https://img.shields.io/badge/Discord-Join_Chat-blue.svg)](https://discord.com/invite/rcK4p8g7Ce)
[![](https://img.shields.io/badge/Documents-Development-blue.svg)](https://dev.muon.net/)
[![](https://img.shields.io/badge/Git_Book-Muon_network-blue.svg)](https://docs.muon.net/muon-network/)

<a href="https://github.com/muon-protocol/muon-node-js/issues/new?assignees=&labels=bug&template=01_BUG_REPORT.md&title=bug%3A+">Report a Bug</a>
·
<a href="https://github.com/muon-protocol/muon-node-js/issues/new?assignees=&labels=enhancement&template=02_FEATURE_REQUEST.md&title=feat%3A+">Request a Feature</a>
.
<a href="https://github.com/muon-protocol/muon-node-js/discussions">Ask a Question</a>

</div>

[Muon](https://muon.net) is an innovative decentralized oracle network (DON) that enables dApps to make their off-chain components decentralized. This repository contains the nodejs implementation of the node in the [Muon Threshold Network](https://docs.muon.net/muon-network/architecture/threshold-network).


## Minimum Requirement

A Linux server with 4 GB of RAM, dual-core CPU, 20GB of storage space. 

## Installation

To run a Muon node on your local machine, you need to first install [Redis](https://redis.com) and [MongoDB](https://www.mongodb.com/).


The following commands can then be used to clone the repository and checkout the `testnet` branch:

    $ git clone git@github.com:muon-protocol/muon-node-js.git --recurse-submodules
    $ cd muon-node-js
    $ git checkout testnet
    
Then node modules can be installed as follows:
    
    $ npm install


## Running a Local Network

A network of local nodes (devnet) can be run and used to develope and test Muon apps or the node.


For instance, a network of 4 nodes is initialized with the following command, where a request can be signed with 3 of them.

    $ npm run devnet-init -- -t=3 -n=4
    
This command generates 4 env files inside `./devnet/nodes` directory where each one can be used to run a node locally.

After initializing the env files, each node can be run separately in a different terminal using the following command:

    $ node_modules/.bin/env-cmd -f ./devnet/nodes/dev-node-1.env ./node_modules/.bin/ts-node src/index.ts

To run other nodes, simply change `dev-node-1.env` to the desired environment file.

Alternatively, the following command can be used to run multiple nodes simultaneously in a single terminal:

    $ npm run devnet-run -- -n=3
    

## Joining Alice Testnet

[This document](https://docs.muon.net/muon-network/muon-nodes/joining-alice-testnet) 
provides instructions on how to run a node using Docker and join the Alice network.

## Developing Muon apps
A Muon app refers to an oracle app that is deployed and runs on the Muon network to fetch and process data and generate an output that can be fed to a smart contract reliably.

To learn more about how to build a Muon app, please refer to the [Muon Development Documentation](https://dev.muon.net/).


## Support
Muon has an active and continuously expanding community. Our [Discord server](https://discord.com/invite/rcK4p8g7Ce) serves as the primary communication channel for day-to-day interactions and addressing development-related inquiries. 
You can ask your development related questions in #dev-help channel.

## License
This project is licensed under the terms of the GNU General Public License v3.0.
A copy of the license can be found at [https://www.gnu.org/licenses/gpl-3.0](https://www.gnu.org/licenses/gpl-3.0).
 