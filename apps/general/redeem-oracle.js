const { axios, soliditySha3, ethCall } = MuonAppUtils
const { times } = require('lodash');
const web3 = require('web3');

const ORACLE_ADDRESS = '0x1Bc270B2bE5c361784044ccE3f55c896fB5Fdf5A'
const DEI_POOL_ADDRESS = '0x9bd5CC542Bc922e95BA41c0702555e830F2C1cB4'
const TOKEN_ADDRESS = '0xDE5ed76E7c05eC5e4572CfC88d1ACEA165109E44'
const AMOUNT = BigInt(1e18);
const DURATION = 8 * 60 * 60; // 8 hours

const ORACLE_ABI = [{ "inputs": [{ "internalType": "address", "name": "tokenIn", "type": "address" }, { "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "uint256", "name": "timestamp", "type": "uint256" }, { "internalType": "uint256", "name": "duration", "type": "uint256" }], "name": "twap", "outputs": [{ "internalType": "uint256", "name": "_twap", "type": "uint256" }], "stateMutability": "view", "type": "function" }];
const DEI_POOL_ABI = [{ "inputs": [{ "internalType": "address", "name": "", "type": "address" }, { "internalType": "uint256", "name": "", "type": "uint256" }], "name": "redeemPositions", "outputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }, { "internalType": "uint256", "name": "timestamp", "type": "uint256" }], "stateMutability": "view", "type": "function" }];

module.exports = {
    APP_NAME: 'redeem',
    APP_ID: 20,

    onRequest: async function (request) {
        let {
            method,
            data: { params }
        } = request

        switch (method) {
            case 'signature':
                const { userAddress, redeemId, chainId } = params

                let timestamp;
                try {
                    timestamp = (await ethCall(
                        DEI_POOL_ADDRESS,
                        'redeemPositions',
                        [
                            userAddress,
                            redeemId
                        ],
                        DEI_POOL_ABI,
                        'ftm'
                    ))['timestamp']
                } catch {
                    throw { message: 'Error on pool contract' }
                }

                let price;
                try {
                    price = await ethCall(
                        ORACLE_ADDRESS,
                        'twap',
                        [
                            TOKEN_ADDRESS,
                            AMOUNT,
                            timestamp,
                            DURATION
                        ],
                        ORACLE_ABI,
                        'ftm'
                    )
                } catch {
                    throw { message: `You should wait ${(DURATION / 60 / 60).toFixed(0)} hours for redeem` }
                }

                return {
                    userAddress,
                    redeemId,
                    price,
                    chainId
                }


            default:
                throw { message: `Unknown method ${params}` }
        }
    },

    hashRequestResult: function (request, result) {
        let {
            method,
            data: { params }
        } = request
        switch (method) {
            case 'signature': {
                let { userAddress, redeemId, price, chainId } = result

                return soliditySha3([
                    { type: 'uint32', value: this.APP_ID },
                    { type: 'address', value: userAddress },
                    { type: 'uint256', value: redeemId },
                    { type: 'uint256', value: price },
                    { type: 'uint256', value: chainId }
                ])
            }
            default:
                return null
        }
    }
}
