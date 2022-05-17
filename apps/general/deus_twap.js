const { axios, toBaseUnit, soliditySha3, ethCall, BN } = MuonAppUtils

const SPOOKY_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/vahid-dev/deus-price-spooky'
const SPIRIT_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/vahid-dev/deus-price-spirit'

const TELORANCE = 0.10;

const TIME = 12 * 60 * 60; // seconds

function getQuery(timestamp) {
    const toTimestamp = timestamp;
    const fromTimestamp = toTimestamp - TIME;

    const query = `{
        pointA: twapPoints(
            first: 1,
            where: {
                timestamp_lte: ${fromTimestamp}
            },
            orderBy: timestamp,
            orderDirection: desc
        ) {
            numerator
            denominator
            timestamp
        }
        pointB: twapPoints(
            first: 1,
            where: {
                timestamp_lte: ${toTimestamp}
            },
            orderBy: timestamp,
            orderDirection: desc
        ) {
            numerator
            denominator
            timestamp
        }
        pricePoints(
            first: 1,
            orderBy: timestamp,
            orderDirection: desc
        ) {
            id
            timestamp
            priceDeusFtm
            priceFtmUsdc
            priceDeusUsdc
        }
    }`

    return query
}

async function getSubgraphPrice(subgraphUrl, timestamp) {
    const {
        data: { data }
    } = await axios.post(subgraphUrl, {
        query: getQuery(timestamp)
    })

    const lastPrice = new BN(data.pricePoints[0].priceDeusUsdc);
    const lastFactor = new BN(
        (
            timestamp -
            +data.pricePoints[0].timestamp
        ) * (
            +data.pricePoints[0].id + 1
        )
    );

    const numerator = (new BN(data.pointB[0].numerator)).sub(new BN(data.pointA[0].numerator)).add(lastPrice.mul(lastFactor))
    const denominator = (new BN(data.pointB[0].denominator)).sub(new BN(data.pointA[0].denominator)).add(lastFactor);

    const price = numerator.div(denominator);

    return price;
}

async function getSpookyOnChainPrice() {

    const reserves = await ethCall(
        '0xaf918ef5b9f33231764a5557881e6d3e5277d456',
        'getReserves',
        [],
        [{ "inputs": [], "name": "getReserves", "outputs": [{ "internalType": "uint112", "name": "_reserve0", "type": "uint112" }, { "internalType": "uint112", "name": "_reserve1", "type": "uint112" }, { "internalType": "uint32", "name": "_blockTimestampLast", "type": "uint32" }], "stateMutability": "view", "type": "function" }],
        'ftm'
    )

    const deusFtm = (new BN(reserves._reserve0)).mul(new BN(toBaseUnit('1', '18'))).div(new BN(reserves._reserve1))

    // Ftm price form chainlink
    const ftmUsdc = (new BN(await ethCall(
        '0xf4766552D15AE4d256Ad41B6cf2933482B0680dc',
        'latestAnswer',
        [],
        [{ "inputs": [], "name": "latestAnswer", "outputs": [{ "internalType": "int256", "name": "", "type": "int256" }], "stateMutability": "view", "type": "function" }],
        'ftm'
    ))).mul(new BN(toBaseUnit('1', '10')))

    const deusUsdc = deusFtm.mul(ftmUsdc).div(new BN(toBaseUnit('1', '18')));

    return deusUsdc
}


function isPriceToleranceOk(firstPrice, spookyPrice, spiritPrice, spookyOnChainPrice) {
    firstPrice = new BN(spookyPrice);
    spookyPrice = new BN(spookyPrice);
    spiritPrice = new BN(spiritPrice);
    spookyOnChainPrice = new BN(spookyOnChainPrice);

    if (firstPrice.sub(spookyPrice).abs().div(firstPrice) > TELORANCE) {
        return false
    }

    if (firstPrice.sub(spiritPrice).abs().div(firstPrice) > TELORANCE) {
        return false
    }

    if (firstPrice.sub(spookyOnChainPrice).abs().div(firstPrice) > TELORANCE) {
        return false
    }

    return true
}

module.exports = {
    APP_NAME: 'deus_twap',
    APP_ID: 30,

    onRequest: async function (request) {
        let {
            method,
            data: { params }
        } = request

        switch (method) {
            case 'price':
                const timestamp = (new Date().getTime() / 1000).toFixed(0);

                const prices = await Promise.all([
                    getSubgraphPrice(SPOOKY_SUBGRAPH, timestamp),
                    getSubgraphPrice(SPIRIT_SUBGRAPH, timestamp),
                    getSpookyOnChainPrice()
                ])

                return {
                    a: prices[0].toString(),
                    b: prices[1].toString(),
                    c: prices[2].toString(),
                    timestamp
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
            case 'price': {
                const { a, b, c } = result

                if (!isPriceToleranceOk(request.data.result.a, a, b, c)) {
                    throw { message: 'Price threshold exceeded' }
                }

                const res = soliditySha3([
                    { type: 'uint32', value: this.APP_ID },
                    { type: 'uint256', value: request.data.result.a },
                    { type: 'uint256', value: request.data.result.timestamp }
                ])

                return res;

            }
            default:
                return null
        }
    }
}
