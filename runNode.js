const fs = require('fs')
const { exec, spawn } = require('child_process')
const parseArgv = require('./utils/parseArgv')

function runMuonNode(node_n) {
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
}

async function runNodes() {
  let params = parseArgv()
  let node_n = params['n'] ? Number(params['n']) : 2
  let port = params['p'] ? Number(params['p']) : 8080
  const dir = './dev-chain'
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {
      recursive: true
    })
  }
  if (params['setup']) {
    console.log('setup envs')
    const result = spawn('node', [
      'generateEnvs.js',
      `-n=${node_n}`,
      `-p=${port}`
    ])
    result.stdout.on('data', (data) => {
      runMuonNode(node_n)
    })

    // await exec(`node generateEnvs.js -n=${node_n} -p=${port}`)
  } else {
    if (fs.existsSync(`./dev-chain/dev-node-${node_n}.env`)) {
      runMuonNode(node_n)
    } else {
      console.log('Generating Envs...')
      const result = spawn('node', [
        'generateEnvs.js',
        `-n=${node_n}`,
        `-p=${port}`
      ])
      result.stdout.on('data', (data) => {
        runMuonNode(node_n)
      })
    }
  }

  // exec(
  //   `./node_modules/.bin/env-cmd -f ./dev-chain/dev-node-${i}.env babel-node index.js`
  // )

  console.log(`running ${node_n} nodes ...`)
}

runNodes()
