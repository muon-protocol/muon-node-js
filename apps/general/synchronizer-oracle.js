const { axios, soliditySha3, ethCall } = MuonAppUtils
const web3 = require('web3');

const SYNCHRONIZER_SERVER = 'https://oracle1.deus.finance'

const ACTIONS = {
    close: 0,
    sell: 0,
    open: 1,
    buy: 1
}

const CHAINS = {
    mainnet: 1,
    rinkeby: 4,
    polygon: 137,
    xdai: 100,
    bsc: 56,
    fantom: 250,
    heco: 128
}

module.exports = {
    APP_NAME: 'synchronizer',
    APP_ID: 9,

    onRequest: async function (request) {
        let {
            method,
            nSign,
            data: { params }
        } = request

        switch (method) {
            case 'signature':
                let { tokenId, action, chain, useMultiplier} = params

                const address = web3.utils.toChecksumAddress(tokenId);

                const currentTimestamp = Date.now() / 1000

                const tokens = await axios
                    .get(`${SYNCHRONIZER_SERVER}/${chain}/signatures.json?timestamp=${currentTimestamp}`)
                    .then(({ data }) => data)

                const timestamp = tokens['timestamp']
                if (currentTimestamp - timestamp > 2.5 * 60) {
                    throw { message: 'Price is outdated' }
                }

                if (!(address in tokens)) {
                    throw { message: 'Unknown token address' }
                }

                const token = tokens[tokenId]

                return {
                    price: token.price,
                    address: address,
                    action: action,
                    chain: chain,
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
                let {price, address, action, chain} = result

                return soliditySha3([
                    { type: 'uint32', value: this.APP_ID },
                    { type: 'address', value: String(address) },
                    { type: 'uint256', value: String(price) },
                    { type: 'uint256', value: String(ACTIONS[action]) },
                    { type: 'uint256', value: String(CHAINS[chain]) },
                    { type: 'uint256', value: request.data.timestamp }
                ])

            }
            default:
                return null
        }
    }
}
