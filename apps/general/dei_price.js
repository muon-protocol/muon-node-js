const { axios, soliditySha3, ethCall, BN, toBaseUnit } = MuonAppUtils
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

const ROUTER_API = 'https://router.firebird.finance'

const PRICE_TOLERANCE = '0.0005'

module.exports = {
    APP_NAME: 'dei_price',
    APP_ID: 25,
    REMOTE_CALL_TIMEOUT: 30000,

    isPriceToleranceOk: function (price, expectedPrice) {
        let priceDiff = new BN(price).sub(new BN(expectedPrice)).abs()

        if (
            new BN(priceDiff)
                .div(new BN(expectedPrice))
                .gt(toBaseUnit(PRICE_TOLERANCE, '18'))
        ) {
            return false
        }
        return true
    },
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
                    params: firebirdParams
                })
                const amountOut = maxReturn.totalTo
                const firebirdPrice = (new BN(amountIn)).mul(new BN(toBaseUnit('1', '12'))).mul(new BN(toBaseUnit('1', '18'))).div(new BN(amountOut));
                const price = BN.max(firebirdPrice, new BN(toBaseUnit('0.94', '18')));
        
                return {
                    chain: chain,
                    amountIn: amountIn,
                    price: String(price)

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

                if (
                    !this.isPriceToleranceOk(
                        price,
                        request.data.result.price
                    )
                ) {
                    throw { message: 'Price threshold exceeded' }
                }

                return soliditySha3([
                    { type: 'uint32', value: this.APP_ID },
                    { type: 'uint256', value: String(amountIn) },
                    { type: 'uint256', value: price },
                    { type: 'uint256', value: String(CHAINS[chain]) },
                    { type: 'uint256', value: request.data.timestamp }
                ])

            }
            default:
                return null
        }
    }
}
