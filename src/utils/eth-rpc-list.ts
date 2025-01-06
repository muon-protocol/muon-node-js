import lodash from "lodash";

const oldEnvKeys = {
  1: "WEB3_PROVIDER_ETH",
  3: "WEB3_PROVIDER_ROPSTEN",
  4: "WEB3_PROVIDER_RINKEBY",
  56: "WEB3_PROVIDER_BSC",
  97: "WEB3_PROVIDER_BSCTEST",
  250: "WEB3_PROVIDER_FTM",
  4002: "WEB3_PROVIDER_FTMTEST",
  100: "WEB3_PROVIDER_XDAI_MAINNET",
  77: "WEB3_PROVIDER_XDAI_SOKOL_TESTNET",
  137: "WEB3_PROVIDER_POLYGON",
  80001: "WEB3_PROVIDER_MUMBAI",
  43113: "WEB3_PROVIDER_AVALANCHE_FUJI_TESTNET",
  43114: "WEB3_PROVIDER_AVALANCHE_MAINNET",
  421611: "WEB3_PROVIDER_ARBITRUM_TESTNET",
  421614: "WEB3_PROVIDER_ARBITRUM_SEPOLIA",
  42161: "WEB3_PROVIDER_ARBITRUM_MAINNET",
  1088: "WEB3_PROVIDER_METIS",
  10: "WEB3_PROVIDER_OPTIMISM",
  420: "WEB3_PROVIDER_OPTIMISM_TESTNET",
  11155420: "WEB3_PROVIDER_OPTIMISM_SEPOLIA",
  59144: "WEB3_PROVIDER_LINEA",

  8453: "WEB3_PROVIDER_BASE",
  84532: "WEB3_PROVIDER_BASE_SEPOLIA",
  81457: "WEB3_PROVIDER_BLAST",
  11155111: "WEB3_PROVIDER_SEPOLIA",

  7001: "WEB3_PROVIDER_ZETACHAIN_TESTNET",
  7000: "WEB3_PROVIDER_ZETACHAIN",
  146: "WEB3_PROVIDER_SONIC"
}

/**
 * Each network PRC urls should be define like WEB3_PROVIDER_{chainId}=<URL>|<URL>|...
 * Example of ethereum mainnet providers: `WEB3_PROVIDER_1=https://***.com|https://***.com`
 * @param chainId
 */
function getEnvProviders(chainId: string|number): string[] {
  const splitItems = (str:string) => str.split("|")
    .map((rpc:string) => rpc.trim())
    .filter(rpc => !!rpc)

  if(!!process.env[`WEB3_PROVIDER_${chainId}`]){
    return splitItems(process.env[`WEB3_PROVIDER_${chainId}`]!);
  }
  if(process.env[oldEnvKeys[chainId]]) {
    return splitItems(process.env[oldEnvKeys[chainId]]!)
  }
  return [];
}

const DefaultRpcList = {
  "ganache": [
    "http://localhost:8545"
  ],

  /** ethereum mainnet */
  1: [
    "https://rpc.ankr.com/eth",
    //"https://mainnet.eth.cloud.ava.do",
    //"https://cloudflare-eth.com"
  ],

  // /** ethereum ropsten testnet */
  // 3: [
  //   "https://rpc.ankr.com/eth_ropsten",
  // ],
  //
  // /** ethereum rinkeby testnet */
  // 4: [
  //   "https://rpc.ankr.com/eth_rinkeby",
  // ],

  /** ethereum goerli testnet */
  5: [
    "https://rpc.ankr.com/eth_goerli",
    "https://goerli.blockpi.network/v1/rpc/public",
    "https://eth-goerli.public.blastapi.io",
  ],

  /** Binance Smart Chain mainnet */
  56: [
    "https://bsc-dataseed.binance.org",
    "https://bsc-dataseed1.binance.org",
    "https://bsc-dataseed2.binance.org",
    "https://bsc-dataseed3.binance.org",
    "https://bsc-dataseed4.binance.org",
    "https://rpc.ankr.com/bsc",
  ],

  /** Optimism mainnet */
  10: [
    "https://mainnet.optimism.io",
    "https://rpc.ankr.com/optimism",
    "https://optimism-mainnet.public.blastapi.io"
  ],

  /** Optimism testnet */
  420: [
    "https://goerli.optimism.io",
    "https://rpc.ankr.com/optimism_testnet",
    "https://optimism-goerli.public.blastapi.io",
  ],

  11155420: [
    "https://rpc.ankr.com/optimism_sepolia",
    "https://sepolia.optimism.io"
  ],

  /** BSC testnet */
  97: [
    "https://bsc-testnet.publicnode.com",
    "https://rpc.ankr.com/bsc_testnet_chapel",
    "https://data-seed-prebsc-1-s1.binance.org:8545",
    "https://data-seed-prebsc-1-s2.binance.org:8545",
    "https://data-seed-prebsc-2-s1.binance.org:8545",
    "https://data-seed-prebsc-2-s2.binance.org:8545",
    // "https://bsc-testnet.public.blastapi.io",
    "https://data-seed-prebsc-1-s3.binance.org:8545",
    "https://data-seed-prebsc-2-s3.binance.org:8545"
  ],

  /**  */
  250: [
    "https://rpc.ankr.com/fantom",
    "https://rpcapi.fantom.network",
    "https://fantom-mainnet.public.blastapi.io",
    "https://rpc.fantom.network",
  ],

  /**  */
  4002: [
    "https://rpc.ankr.com/fantom_testnet",
    "https://rpc.testnet.fantom.network",
  ],

  /** Gnosis mainnet */
  100: [
    "https://rpc.ankr.com/gnosis",
    "https://rpc.gnosischain.com",
    "https://gnosis-mainnet.public.blastapi.io",
  ],

  // /** XDAI SOKOL testnet */
  // 77: [
  //   "https://sokol.poa.network",
  // ],

  /** Polygon mainnet */
  137: [
    "https://rpc.ankr.com/polygon",
    "https://polygon-rpc.com",
    "https://polygon-mainnet.public.blastapi.io",
    //"https://polygon.llamarpc.com",
    "https://polygon-bor-rpc.publicnode.com",
  ],

  /** Polygon MUMBAI testnet */
  80001: [
    "https://rpc.ankr.com/polygon_mumbai",
    "https://polygon-testnet.public.blastapi.io",
    "https://matic-mumbai.chainstacklabs.com",
    "https://endpoints.omniatech.io/v1/matic/mumbai/public",
  ],

  /** Avalanche mainnet */
  43114: [
    "https://rpc.ankr.com/avalanche",
    "https://1rpc.io/avax/c",
    "https://avalanche-c-chain.publicnode.com",
    "https://api.avax.network/ext/bc/C/rpc",
  ],

  /** Avalanche FUJI testnet */
  43113: [
    "https://rpc.ankr.com/avalanche_fuji",
    "https://api.avax-test.network/ext/bc/C/rpc",
    "https://ava-testnet.public.blastapi.io/ext/bc/C/rpc",
  ],

  /** Arbitrum mainnet */
  42161: [
    "https://arb1.arbitrum.io/rpc",
    "https://rpc.ankr.com/arbitrum",
    "https://arbitrum-one.public.blastapi.io",
  ],

  /** Arbitrum testnet */
  421611: [
    "https://rinkeby.arbitrum.io/rpc",
  ],

  /** Arbitrum sepolia */
  421614: [
    "https://rpc.ankr.com/arbitrum_sepolia",
    "https://sepolia-rollup.arbitrum.io/rpc"
  ],

  /** Metis Andromeda mainnet */
  1088: [
    "https://andromeda.metis.io/?owner=1088",
  ],

  /** Metis stardust testnet */
  588: [
    "https://stardust.metis.io/?owner=588",
  ],

  59144: [
    "https://rpc.linea.build"
  ],

  8453: [
    "https://rpc.ankr.com/base",
    //"https://base-rpc.publicnode.com",
    //"https://base.drpc.org"
  ],

  84532: [
    "https://rpc.ankr.com/base_sepolia",
    "https://sepolia.base.org"
  ],

  81457: [
    "https://blast.gasswap.org",
    "https://rpc.ankr.com/blast",
    "https://rpc.blast.io",
    "https://blastl2-mainnet.public.blastapi.io"    
  ],

  11155111: [
    "https://rpc.ankr.com/eth_sepolia"
  ],

  7000: [
    "https://zetachain-evm.blockpi.network/v1/rpc/public"
  ],

  7001: [
    "https://zetachain-athens-evm.blockpi.network/v1/rpc/public"
  ],

  146: [
    "https://rpc.soniclabs.com",
    "https://rpc.ankr.com/sonic_mainnet",
    "https://sonic.drpc.org"
  ]
}

const finalRpcList = Object.entries(DefaultRpcList)
  .map(([chainId, defaultList]) => {
    let envRpcList = getEnvProviders(chainId);
    return [
      chainId,
      lodash.uniq(lodash.shuffle([
        ...envRpcList,
        ...defaultList
      ]))
    ]
  })
  // @ts-ignore
  .reduce((obj, [id, list])=>(obj[id]=list, obj),{})

export default finalRpcList;
