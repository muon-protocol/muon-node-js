const { soliditySha3, BN, multiCall } = MuonAppUtils

const getTimestamp = () => Math.floor(Date.now() / 1000)

const SOLIDEX_DEPOSIT_ZAP = 'SolidexDepositZap'
const ERC20 = 'ERC20'
const SPIRIT_ROUTER = 'SpiritRouter'

const BASE_ROUTER_CONTRACT = '0x46AC9383D3e23167be2e4E728a11A49643514eD3'
const SPIRIT_SWAP_CONTRACT = '0x16327E3FbDaCA3bcF7E38F5Af2599D2DDc33aE52'

const SPIRIT_SWAP_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' }
    ],
    name: 'getAmountsOut',
    outputs: [
      { internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]

const GET_RESERVES_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
      { internalType: 'bool', name: 'stable', type: 'bool' }
    ],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint256', name: 'reserveA', type: 'uint256' },
      { internalType: 'uint256', name: 'reserveB', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]

const TOTAL_SUPPLY_ABI = [
  {
    constant: true,
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  }
]

const USDC = '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75'
const DEI = '0xDE12c7959E1a72bbe8a5f7A1dc8f8EeF9Ab011B3'
const LP_TOKENS = {
  '0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0': {
    tokenA: {
      address: USDC,
      scale: new BN('1000000000000')
    },
    tokenB: {
      address: DEI,
      scale: new BN('1')
    }
  }
}

const TOKENS = {
	DEUS: {
		pool: {
			pair: "",//TODO: fixme
			index: 0,// TODO: fixme
			pairToken: DEI
		}
	},
	DEI: {

	}
}

const PRICE_TOLERANCE = 0.05;
const FANTOM_ID = 250;
const SCALE = new BN('1000000000000000000');

async function tokenPrice(token){
  if(token==USDC){
    return SCALE;
  }
  if (token == DEI) {
    return new BN(ret[1]).mul(new BN('1000000000000'))
  }
  // TODO: handle DEUS/LQDR/SCREAM

  // if(token exists on TOKENS){
  // pool = TOKENS[token].pool;
  // 	tokenPrice(pool.pairToken) * 
  // 	tvwap(token, pool.index, pool.pair) // 1 DEUS = ? DEI
  // }

  // {pair, token, index}
}

async function LPTokenPrice(token){
  let tokenParams = LP_TOKENS[token];
  let reserves = await ethCall(
    BASE_ROUTER_CONTRACT,
    'getReserves',
    //TODO: add true/false to LP_TOKENS
    [tokenParams.tokenA.address, tokenParams.tokenB.address, true],
    BASE_ROUTER_ABI,
    FANTOM_ID
  );

  let totalSupply = new BN(await ethCall(
    token,
    'totalSupply',
    [],
    ERC20_ABI,
    FANTOM_ID
  ));

  let reserveA = (new BN(reserves.reserveA)).mul(
    tokenParams.tokenA.scale
  );
  let reserveB = (new BN(reserves.reserveB)).mul(
    tokenParams.tokenB.scale
  );
  console.log(reserveA.toString(), reserveB.toString());

  let totalUSDA = reserveA.mul(await tokenPrice(
    tokenParams.tokenA.address
  )).div(SCALE);

  let totalUSDB = reserveB.mul(await tokenPrice(
    tokenParams.tokenB.address
  )).div(SCALE);

  let totalUSD = totalUSDA.add(totalUSDB);

  return totalUSD.mul(SCALE).div(totalSupply).toString();
}

module.exports = {
  APP_NAME: 'dei_oracles',
  APP_ID: 15,

  onRequest: async function (request) {
    let {
      method,
      nSign,
      data: { params }
    } = request

    switch (method) {
      case 'lp_price': {
        let {token, hashTimestamp} = params;
        let currentTime = getTimestamp();

        if(!LP_TOKENS[token] && !TOKENS[token]){
          throw "Invalid token";
        }

        var tokenPrice = 0;
        if(LP_TOKENS[token]){
        	tokenPrice = await LPTokenPrice(token);
        }else{
        	tokenPrice = await tokenPrice(token);
        }

        return {
          token: token,
          tokenPrice: tokenPrice,
          ...(hashTimestamp ? {timestamp: request.data.timestamp} : {})
        }
      }

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  isPriceToleranceOk: function (price, expectedPrice) {
    let priceDiff = Math.abs(price - expectedPrice)
    if (priceDiff / expectedPrice > PRICE_TOLERANCE) {
      return false
    }
    return true
  },

  hashRequestResult: function (request, result) {
    let {
      method,
      data: { params }
    } = request;
    console.log(result, request);
    let { hashTimestamp } = params;
    switch (method) {
      case 'lp_price': {
        if (
          !this.isPriceToleranceOk(
            result.tokenPrice,
            request.data.result.tokenPrice
          )
        ) {
          throw { message: 'Price threshold exceeded' }
        }
        let { token, tokenPrice } = result

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: token },
          { type: 'uint256', value: request.data.result.tokenPrice },
          ...(hashTimestamp
            ? [{ type: 'uint256', value: request.data.timestamp }]
            : [])
        ])
      }
      default:
        return null
    }
  }
}
