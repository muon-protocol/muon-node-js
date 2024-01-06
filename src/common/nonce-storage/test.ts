import { AppNonceBatchJson } from "../../utils/tss/app-nonce-batch";
import { DEPLOYMENT_APP_ID, GENESIS_SEED } from "../contantes.js";
import { NonceBatch } from "../mpc/dist-nonce";
import {startServer, put, pickIndex} from "./index.js"
import _ from "lodash"

async function run() {
	console.log("start ...");
	const n=50000;

	startServer();

	await put({
		seed: GENESIS_SEED,
		appNonceBatch: {
			id: "sample",
			partyInfo: {appId: DEPLOYMENT_APP_ID, seed: GENESIS_SEED},
			nonceBatch: {
				n,
				partners: [],
				nonces: []
			}
		},
		owner: "1",
	})

	let result = await Promise.all(
		new Array(n).fill(0).map((_,i) => {
			return pickIndex({seed: GENESIS_SEED, owner: "1"});
		})
	)

	if(_.uniq(result).length !== n) {
		throw "picked index missmatch."
	}

	console.log("All done successfully")
}

run()
	.catch((e) => console.log(e))
	.finally(() => {
		process.exit(0);
	})
