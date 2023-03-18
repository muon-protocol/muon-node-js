require('dotenv').config({path:__dirname+'/../.env'});
const netConf = require('../config/global/net.default.conf.json');
const nodeManagerContractAddress = netConf.nodeManager.address;
const nodeManagerABI = require('../src/data/NodeManager-ABI.json');

const Web3 = require("web3")

//TODO: load the correct provider
const web3 = new Web3(process.env.WEB3_PROVIDER_BSCTEST);

const nodeManagerContract = new web3.eth.Contract(
	nodeManagerABI,
	nodeManagerContractAddress
);

nodeManagerContract.methods.configs('commit-id').call().then(
	out => {
		console.log(out)
	}
);
