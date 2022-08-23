const Web3 = require('web3')
const web3Instance = new Web3()

module.exports = function soliditySha3(params) {
    return web3Instance.utils.soliditySha3(...params)
}
