const { callMuon } = require('./helpers')
const ERC20_ABI = require('./data/erc20-abi')
const TETHER_ON_ETH = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const DOMMY_ADDRESS = '0x8CE8cD307657df1D8E5CDf229527C576662ff342'

describe('Eth app test', () => {
  // node should work after all crash scenario
  afterAll(async () => {
    let { success, result } = await callMuon({
      app: 'eth',
      method: 'call',
      params: {
        address: TETHER_ON_ETH,
        method: 'balanceOf',
        params: [DOMMY_ADDRESS],
        abi: ERC20_ABI,
        network: 'eth'
      }
    })
    expect(success).toBe(true)
    expect(result.confirmed).toBe(true)
  })

  it('crash check scenario #1 (wrong address)', async () => {
    let response = await callMuon({
      app: 'eth',
      method: 'call',
      params: {
        address: '0x54545454',
        method: 'balanceOf',
        params: [DOMMY_ADDRESS],
        abi: ERC20_ABI,
        network: 'eth'
      }
    })
    let { success, result, error } = response
    expect(success).toBe(false)
    expect(!!error).toBe(true)
    expect(result).toBe(undefined)
  })

  it('crash check scenario #1 (wrong params)', async () => {
    let response = await callMuon({
      app: 'eth',
      method: 'call',
      params: {
        address: TETHER_ON_ETH,
        method: 'balanceOf',
        params: ['0x44'],
        abi: ERC20_ABI,
        network: 'eth'
      }
    })
    let { success, result, error } = response
    expect(success).toBe(false)
    expect(!!error).toBe(true)
    expect(result).toBe(undefined)
  })

  it('crash check scenario #2 (wrong method)', async () => {
    let response = await callMuon({
      app: 'eth',
      method: 'call',
      params: {
        address: TETHER_ON_ETH,
        method: 'bla-bla',
        params: [DOMMY_ADDRESS],
        abi: ERC20_ABI,
        network: 'eth'
      }
    })
    let { success, result, error } = response
    expect(success).toBe(false)
    expect(!!error).toBe(true)
    expect(result).toBe(undefined)
  })

  it('crash check scenario #3 (wrong network)', async () => {
    let response = await callMuon({
      app: 'eth',
      method: 'call',
      params: {
        address: TETHER_ON_ETH,
        method: 'balanceOf',
        params: [DOMMY_ADDRESS],
        abi: ERC20_ABI,
        network: 'bla-bla'
      }
    })
    let { success, result, error } = response
    expect(success).toBe(false)
    expect(!!error).toBe(true)
    expect(result).toBe(undefined)
  })
})
