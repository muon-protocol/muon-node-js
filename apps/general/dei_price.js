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

const FIREBIRD_ROUTER_API = 'https://router.firebird.finance'
const PARA_ROUTER_API = 'https://api.paraswap.io/prices'
const PRICE_TOLERANCE = '0.0005'
const ABI_POOLGATEWAY = [{ "inputs": [], "name": "discountRate", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }]
const poolGatewayAddress = '0x2a6121808A4a0a6Be6B9a81c1F5A353BD987f9fb'

module.exports = {
    APP_NAME: 'dei_price',
    APP_ID: 25,
    REMOTE_CALL_TIMEOUT: 30000,

    getFirebirdDeiPrice: async function (routerApi) {
        const amountIn = new BN(toBaseUnit('1', '21'))
        const firebirdParams = {
            from: '0xDE12c7959E1a72bbe8a5f7A1dc8f8EeF9Ab011B3',
            to: '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75',
            amount: String(amountIn),
            dexes: "beethovenx,solidly,spiritswap,spookyswap"
        }
        const { data: { maxReturn } } = await axios.get(routerApi, {
            headers: { 'Content-Type': 'application/json' },
            params: firebirdParams
        })
        const amountOut = maxReturn.totalTo
        const marketPrice = (new BN(amountOut)).mul(new BN(toBaseUnit('1', '30'))).div(new BN(amountIn));
        return marketPrice
    },

    getFirebirdMeanDeiPrice: async function (routerApi, amountIn) {
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
        return firebirdPrice
    },

    getParaDeiPrice: async function (routerApi, chain) {
        const amountIn = new BN(toBaseUnit('1', '21'))
        const params = {
            srcToken: '0xDE12c7959E1a72bbe8a5f7A1dc8f8EeF9Ab011B3',
            destToken: '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75',
            amount: String(amountIn),
            network: CHAINS[chain]
        }
        const { data: { priceRoute } } = await axios.get(routerApi, {
            headers: { 'Content-Type': 'application/json' },
            params: params
        })
        const amountOut = priceRoute.destAmount
        const marketPrice = (new BN(amountOut)).mul(new BN(toBaseUnit('1', '30'))).div(new BN(amountIn));
        return marketPrice
    },
    getPoolGatewayDiscount: async function (chain) {
        let {
            discount
        } = await ethCall(
            poolGatewayAddress,
            'discountRate',
            [],
            ABI_POOLGATEWAY,
            CHAINS[chain]
        )
        return new BN(discount)
    },

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
                if (!chain) throw { message: 'Invalid chain' }
                if (!amountIn) throw { message: 'Invalid amount_in' }
                const routerApi = `${FIREBIRD_ROUTER_API}/${chain}/route`

                const result = await Promise.all([
                    this.getFirebirdMeanDeiPrice(routerApi, amountIn),
                    this.getFirebirdDeiPrice(routerApi),
                    this.getParaDeiPrice(PARA_ROUTER_API, chain),
                    this.getPoolGatewayDiscount(chain)
                ]);

                const firebirdMeanDeiPrice = result[0];
                const firebirdMarketPrice = result[1];
                const paraMarketPrice = result[2];
                const poolGatewayDiscount = result[3];

                if (
                    !this.isPriceToleranceOk(
                        paraMarketPrice,
                        firebirdMarketPrice
                    )
                ) {
                    throw { message: 'Price threshold exceeded' }
                }
                const meanPrice = BN.max(firebirdMeanDeiPrice, firebirdMarketPrice.add(poolGatewayDiscount));

                return {
                    chain: chain,
                    amountIn: amountIn,
                    meanPrice: String(meanPrice),
                    marketPrice: String(firebirdMarketPrice)
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
                let { meanPrice, marketPrice, chain, amountIn } = result

                if (
                    !this.isPriceToleranceOk(
                        meanPrice,
                        request.data.result.meanPrice
                    )
                ) {
                    throw { message: 'Price threshold exceeded' }
                }

                return soliditySha3([
                    { type: 'uint32', value: this.APP_ID },
                    { type: 'uint256', value: String(amountIn) },
                    { type: 'uint256', value: meanPrice },
                    { type: 'uint256', value: marketPrice },
                    { type: 'uint256', value: String(CHAINS[chain]) },
                    { type: 'uint256', value: request.data.timestamp }
                ])

            }
            default:
                return null
        }
    }
}
