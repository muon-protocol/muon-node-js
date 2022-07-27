const dotenv = require('dotenv')
dotenv.config()
const fs = require('fs')
const emoji = require('node-emoji')
const { spawn } = require('child_process')
const parseArgv = require('./src/utils/parseArgv')

function runMuonNode(node_n) {
  try {
    for (let i = 1; i <= node_n; i++) {
      const result = spawn('./node_modules/.bin/env-cmd', [
        '-f',
        `./dev-chain/dev-node-${i}.env`,
        'babel-node',
        './src/index.js'
      ])
      result.stdout.on('data', (data) => {
        console.log(data.toString())
      })
      result.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`)
      })
    }
  } catch (error) {
    console.log('Error happend in run nodes:', error)
  }
}

async function runNodes() {
  let params = parseArgv()
  let node_n = params['n'] ? Number(params['n']) : 2
  let port = params['p'] ? Number(params['p']) : 8080
  const dir = './dev-chain'

  if (params['setup']) {
    const configFiles = fs
      .readdirSync('./config')
      .filter((item) => item.startsWith('dev-node'))

    if (configFiles.length > 0) {
      configFiles.forEach((item) => {
        // delete dev-node directory recursively
        fs.rm(`./config/${item}`, { recursive: true, force: true }, (err) => {
          if (err) {
            throw err
          }
        })
      })
    }
    // delete directory recursively
    fs.rm(dir, { recursive: true, force: true }, (err) => {
      if (err) {
        throw err
      }
      fs.mkdirSync(dir, {
        recursive: true
      })
    })
    // console.log('Setting Up Envs ...')
    const result = spawn('node', [
      'devnet-generate-envs.js',
      `-n=${node_n}`,
      `-p=${port}`
    ])
    result.stdout.on('data', (data) => {
      console.log(data.toString())
    })
    result.on('exit', () => {
      runMuonNode(node_n)
    })
    // await exec(`node devnet-generate-envs.js -n=${node_n} -p=${port}`)
  } else {
    if (fs.existsSync(`./dev-chain/dev-node-${node_n}.env`)) {
      runMuonNode(node_n)
      for (let index = 1; index <= node_n; index++) {
        let data = fs.readFileSync(`./dev-chain/dev-node-${index}.env`, 'utf8')
        let lines = data.split('\n')

        let address = lines
          .find((item) => item.trim().startsWith('SIGN_WALLET_ADDRESS'))
          .split('=')
        console.log(
          emoji.get('o'),
          `Node-${index} Ethereum Address: `,
          `${address[1]}\n`
        )
      }
    } else {
      // console.log('Generating Envs...')
      const configFiles = fs
        .readdirSync('./config')
        .filter((item) => item.startsWith('dev-node'))

      if (configFiles.length > 0) {
        configFiles.forEach((item) => {
          // delete dev-node directory recursively
          fs.rm(`./config/${item}`, { recursive: true, force: true }, (err) => {
            if (err) {
              throw err
            }
          })
        })
      }
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {
          recursive: true
        })
      }
      const result = spawn('node', [
        'devnet-generate-envs.js',
        `-n=${node_n}`,
        `-p=${port}`
      ])
      result.stdout.on('data', (data) => {
        console.log(data.toString())
      })
      result.on('exit', () => {
        runMuonNode(node_n)
      })
    }
  }
}

runNodes()
