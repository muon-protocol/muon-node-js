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
                let { tokenId, action, chain, useMultiplier, hashTimestamp} = params

                const address = web3.utils.toChecksumAddress(tokenId);

                const currentTimestamp = Date.now() / 1000

                const tokens = await axios
                    .get(`${SYNCHRONIZER_SERVER}/${chain}/signatures.json?timestamp=${currentTimestamp}`)
                    .then(({ data }) => data)

                const timestamp = tokens['timestamp']
                if (currentTimestamp - timestamp > 7 * 60) {
                    throw { message: 'Price is outdated' }
                }

                if (!(address in tokens)) {
                    throw { message: 'Unknown token address' }
                }

                const token = tokens[tokenId]

                let multiplier = useMultiplier ? 4 : 0;

                return {
                    useMultiplier: useMultiplier,
                    multiplier: multiplier,
                    price: token.price,
                    address: address,
                    action: action,
                    chain: chain,
                    ...(hashTimestamp ? {timestamp: request.data.timestamp} : {})
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
                let { useMultiplier, multiplier, price, address, action, chain , hashTimestamp} = result

                let abi = []

                if (useMultiplier) {
                    abi.push({ type: 'uint256', value: String(multiplier) })
                }

                abi.push(...[
                    { type: 'address', value: String(address) },
                    { type: 'uint256', value: String(price) },
                    { type: 'uint256', value: String(ACTIONS[action]) },
                    { type: 'uint256', value: String(CHAINS[chain]) },
                    { type: 'uint8', value: this.APP_ID },
                    [(hashTimestamp ? { type: 'uint256', value: request.data.timestamp } : {})]
                ])

                return soliditySha3(abi)
            }
            default:
                return null
        }
    }
}
