<h1 align="center">
  <a href="https://www.muon.net/" target="_blank">
    <img src="https://assets.website-files.com/614c6fa0cc868403c37c5e53/614c6fa0cc8684353e7c5e63_muon-logo.svg" alt="Logo" width="302" height="80">
  </a>
</h1>

<div align="center">
  MUON, Decentralize all Off-Chain Components of your dApp.
  <br />
  <br />
  <a href="https://github.com/dec0dOS/amazing-github-template/issues/new?assignees=&labels=bug&template=01_BUG_REPORT.md&title=bug%3A+">Report a Bug</a>
  ·
  <a href="https://github.com/dec0dOS/amazing-github-template/issues/new?assignees=&labels=enhancement&template=02_FEATURE_REQUEST.md&title=feat%3A+">Request a Feature</a>
  .
  <a href="https://github.com/dec0dOS/amazing-github-template/discussions">Ask a Question</a>
</div>

<div align="center">
<br />

![Static Badge](https://img.shields.io/badge/node_js-%3E%3D16.14-blue)
[![](https://img.shields.io/badge/project-libp2p-blue.svg)](http://libp2p.io/)
[![](https://img.shields.io/badge/project-nodejs-blue.svg)](http://libp2p.io/)

![Static Badge](https://img.shields.io/badge/docs-passing-green)
![Static Badge](https://img.shields.io/badge/build-passing-green)


</div>

<details open="open">
<summary>Table of Contents</summary>

- [About](#about)
  - [Built With](#built-with)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Usage](#usage)
    - [Cookiecutter template](#cookiecutter-template)
    - [Manual setup](#manual-setup)
    - [Variables reference](#variables-reference)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Support](#support)
- [License](#license)
- [Acknowledgements](#acknowledgements)

</details>

---

## About
Muon is a decentralized oracle network that carries out data requests from any source. 
Muon acts as a unique inter-blockchain data-availability network that makes messaging and secure data interfacing possible between different chains that are otherwise incompatible.

Muon is creating a network in order to:

- make Web3 interoperable
- scale data feed verification
- secure the metaverse 

To this end, Muon oracle network provides off-chain, on-chain and cross-chain price feeds, event logs, data feeds and random inputs in a secure and decentralized way.


### Built With

- [Node.js](https://github.com/nodejs/node)
- [libp2p](https://github.com/libp2p/js-libp2p)
- [Redis](https://github.com/redis/redis)

## Getting Started

### Prerequisites

To run a Muon node on your local machine, you need to first install [Redis](https://redis.com) and [MongoDB](https://www.mongodb.com/).
Additionally you will need A Linux server with 4 GB of RAM, dual-core CPU, 20GB of storage space. 
<br/>  
If you want to run the Muon node inside a Docker container, please refer to 
[this document](https://docs.muon.net/muon-network/muon-nodes/joining-alice-testnet).


### Usage

#### Cloning this repository
Because of containing submodule, add the `--recurse-submodules` flag to the `clone`/`pull` commands.

    $ git clone <the-repo> --recurse-submodules
    $ git pull --recurse-submodules
If you already cloned the old repo before the `apps` submodule, run the code below

    $ git submodule init
    
#### Run
To run this project execute following command:

    $ env-cmd babel-node index.js
    
Or if you want to run project with a custom env file:

    $ env-cmd -f ./1.env babel-node index.js


#### Auto-Update
Enabling auto-update will trigger an update and restart the server for any commit made to the repository. To enable auto-update, run the following command: 

    bash ./scripts/auto-update.sh -a setup -p '<PM2_APP_NAME|PM2_APP_ID>'

#### Update credentials

    cat >>~/.netrc <<EOF
    machine github.com
        login <USERNAME>
        password <PASSWORD>
    EOF


### Development
#### Run a local devnet

You can run local devnet on port 8080

    docker-compose build --build-arg INFURA_PROJECT_ID=< your infura project id >
    docker-compose up

To check local devnet open http://localhost:8080/v1/?app=tss&method=test in your browser.

After any changes, you will need to build again.

#### Develop MUON app

## Support

Reach out to the maintainer at one of the following places:

- Join our [Discord server](https://discord.com/invite/rcK4p8g7Ce)
- The email which is located [MUON website](https://muon.net)


## Acknowledgements

Thanks for these awesome resources that were used during the development of the **MUON**:

- <https://github.com/Automattic>
- <https://github.com/expressjs>
- <https://github.com/docker>
- <https://github.com/nodejs>
- <https://github.com/libp2p>
- <https://github.com/redis>
- <https://github.com/axios>
- <https://github.com/remy>
- <https://github.com/web3>



