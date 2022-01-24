const dotenv = require('dotenv')
dotenv.config()
const fs = require('fs')
const emoji = require('node-emoji')
const { spawn } = require('child_process')
const parseArgv = require('./utils/parseArgv')

function runMuonNode(node_n) {
  try {
    for (let i = 1; i <= node_n; i++) {
      const result = spawn('./node_modules/.bin/env-cmd', [
        '-f',
        `./dev-chain/dev-node-${i}.env`,
        'babel-node',
        'index.js'
      ])
      result.stdout.on('data', (data) => {
        console.log(data.toString())
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
      'generateEnvs.js',
      `-n=${node_n}`,
      `-p=${port}`
    ])
    result.stdout.on('data', (data) => {
      runMuonNode(node_n)
      console.log(data.toString())
    })

    // await exec(`node generateEnvs.js -n=${node_n} -p=${port}`)
  } else {
    if (fs.existsSync(`./dev-chain/dev-node-${node_n}.env`)) {
      runMuonNode(node_n)
      for (let index = 1; index <= node_n; index++) {
        let data = fs.readFileSync(`./dev-chain/dev-node-${index}.env`, 'utf8')
        let lines = data.split('\n')
        let address = lines[17].split('=')
        console.log(
          emoji.get('o'),
          `Node-${index} Ethereum Address: `,
          `${address[1]}\n`
        )
      }
    } else {
      // console.log('Generating Envs...')
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {
          recursive: true
        })
      }
      const result = spawn('node', [
        'generateEnvs.js',
        `-n=${node_n}`,
        `-p=${port}`
      ])
      result.stdout.on('data', (data) => {
        runMuonNode(node_n)
        console.log(data.toString())
      })
    }
  }
}

runNodes()
