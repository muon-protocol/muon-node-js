import Web3 from 'web3'

export const BNSqrt = (num) => {
  const BN = Web3.utils.BN
  if(num.lt(new BN(0))) {
    throw { message: "Sqrt only works on non-negtiave inputs" }
  }
  if(num.lt(new BN(2))) {
    return num
  }

  const smallCand = BNSqrt(num.shrn(2)).shln(1)
  const largeCand = smallCand.add(new BN(1))

  if (largeCand.mul(largeCand).gt(num)) {
    return smallCand
  } else {
    return largeCand
  }
}
