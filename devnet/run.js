import dotenv from 'dotenv'
dotenv.config()
import fs from 'fs'
import path from 'path'
import emoji from 'node-emoji'
import {spawn} from 'child_process'
import parseArgv from '../src/utils/parseArgv.js'
import {filePathInfo} from "../src/utils/helpers.js";

const {__dirname} = filePathInfo(import.meta)
const BASE_PATH = path.join(__dirname, '..');

function runNodes(node_n) {
  try {
    for (let i = 1; i <= node_n; i++) {
      const result = spawn(`${BASE_PATH}/node_modules/.bin/env-cmd`, [
        '-f',
        `${BASE_PATH}/devnet/nodes/dev-node-${i}.env`,
        'ts-node',
        `${BASE_PATH}/src/index.ts`
      ])
      result.stdout.on('data', (data) => {
        console.log(data.toString())
      })
      result.stderr.on('data', (data) => {
        console.error(data.toString())
      })
    }
  } catch (error) {
    console.log('Error happend in run nodes:', error)
  }
}

async function start() {
  let params = parseArgv()
  let node_n = params['n'] ? Number(params['n']) : 2

  if (!fs.existsSync(`${BASE_PATH}/devnet/nodes/dev-node-${node_n}.env`)) {
    throw `Devnet not initialized. Pleas initialize it with 'devnet-init' command.`
  }
  runNodes(node_n)
  for (let index = 1; index <= node_n; index++) {
    let data = fs.readFileSync(`${BASE_PATH}/devnet/nodes/dev-node-${index}.env`, 'utf8')
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
}

start()
