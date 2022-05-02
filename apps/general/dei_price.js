const { axios, soliditySha3, ethCall } = MuonAppUtils
const web3 = require('web3');

const CHAINS = {
    mainnet: 1,
    rinkeby: 4,
    polygon: 137,
    xdai: 100,
    bsc: 56,
    fantom: 250,
    heco: 128
}

const ROUTER_API = 'https://router.firebird.finance/'

module.exports = {
    APP_NAME: 'dei_price',
    // TODO
    APP_ID: 9,
    REMOTE_CALL_TIMEOUT: 30000,

    onRequest: async function (request) {
        let {
            method,
            data: { params }
        } = request

        switch (method) {
            case 'signature':
                let { chain, amountIn } = params
                const routerApi = `${ROUTER_API}/${chain}/route`
                const firebirdParams = {
                    from: '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75',
                    to: '0xDE12c7959E1a72bbe8a5f7A1dc8f8EeF9Ab011B3',
                    amount: String(amountIn),
                    dexes: "beethovenx,solidly,spiritswap,spookyswap"
                }
                const { data: { maxReturn } } = await axios.get(routerApi, {
                    headers: { 'Content-Type': 'application/json' },
                    firebirdParams
                })
                const amountOut = maxReturn.totalTo.toBigInt()
                const price = BigInt(amountIn) * BigInt(1e12) * BigInt(1e18) / amountOut
                return {
                    chain: chain,
                    amountIn: amountIn,
                    price: price
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
                let { price, chain, amountIn } = result

                return soliditySha3([
                    { type: 'uint32', value: this.APP_ID },
                    { type: 'uint256', value: String(amountIn) },
                    { type: 'uint256', value: String(price) },
                    { type: 'uint256', value: String(CHAINS[chain]) },
                    { type: 'uint256', value: request.data.timestamp }
                ])

            }
            default:
                return null
        }
    }
}
