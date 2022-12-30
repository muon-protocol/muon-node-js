import Web3 from 'web3'
const web3Instance = new Web3()

export default function soliditySha3(params) {
    return web3Instance.utils.soliditySha3(...params)
}
