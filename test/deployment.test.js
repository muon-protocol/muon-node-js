import axios from 'axios'
import * as appCMD from '../src/cmd/modules/cmd-app-mod.ts'
import chalk from 'chalk'
import assert from "assert"
import * as p2pClient from "./Libp2pClient.js"


let nodeResponseLoaded = false;
let nodesResponse = [];
let deployerNodes = [];

const APP_NAME = "price_test";
const GATEWAY_URL = "https://testnet.muon.net";
const DEPLOY_CONFIG = {
    "url": "https://testnet.muon.net/v1"
};



describe('Deployment process', async function () {
    this.timeout(5 * 60000);
    before(async () => {
        await loadNodes();
    });

    describe('Deployment scenario', function () {
        it("Before deploy, app should be undeployed and app status should be NEW", async () => {
            let appStatus = await getAppStatus(APP_NAME);
            if (appStatus.status != "NEW")
                await undeploy(APP_NAME);
            appStatus = await getAppStatus(APP_NAME);
            assert.equal(appStatus.status, "NEW");
        });
        it("After deployment request, app status should be DEPLOYED", async () => {
            await deploy(APP_NAME);
            let appStatus = await getAppStatus(APP_NAME);
            assert.equal(appStatus.status, "DEPLOYED");
        });
        it('App context should be available and equal on all deployers', async () => {
            let compareResult = await checkContextOnAllDeployers();
            assert.equal(compareResult, true);
        });
        it('App context should be available all party nodes', async () => {
            let appStatus = await getAppStatus(APP_NAME);
            let context = await loadAppContext(appStatus.appId);
            let failedNodes = await loadContextFromNodes(appStatus.appId, context.party.partners);
            assert.equal(failedNodes, 0);
        });
        it('All party nodes should be able to execute and sign app requests', async () => {
            let party = await getAppParty();
            let failedNodes = await execRequestOnPartyNodes(APP_NAME, party);
            assert.equal(failedNodes, 0);
        });
    });

    describe('Redeploy scenario', function () {
        let appStatus;
        it('App status should be deployed', async () => {
            appStatus = await getAppStatus(APP_NAME);
            if (appStatus.status != "DEPLOYED")
                await deploy(APP_NAME);
            appStatus = await getAppStatus(APP_NAME);
            assert.equal(appStatus.status, "DEPLOYED");
        });

        let context1, context2;
        it('First context should be available on deployers', async () => {
            context1 = await loadAppContext(appStatus.appId);
            assert.notEqual(context1, null);
        });

        it('After undeploy, app status should be NEW', async () => {
            await undeploy(APP_NAME);
            appStatus = await getAppStatus(APP_NAME);
            assert.equal(appStatus.status, "NEW");
        });

        it('Context should be removed from deployers', async () => {
            let appStatus = await getAppStatus(APP_NAME);
            let deployerNodeIds = deployerNodes.map(node => node.id);
            let failedNodes = await loadContextFromNodes(appStatus.appId, deployerNodeIds);
            assert.equal(failedNodes, deployerNodeIds.length);
        });

        it('After deploy, app status should be DEPLOYED', async () => {
            await deploy(APP_NAME);
            appStatus = await getAppStatus(APP_NAME);
            assert.equal(appStatus.status, "DEPLOYED");
        });

        it('Second context should be available on deployers', async () => {
            context2 = await loadAppContext(appStatus.appId);
            assert.notEqual(context2, null);
        });

        it('First and second context should not be equal', async () => {
            context2 = await loadAppContext(appStatus.appId);
            assert.notEqual(context1.deploymentRequest.reqId, context2.deploymentRequest.reqId);
        });

    });

});

async function loadNodes() {
    return axios.get("https://monitor1.muon.net/nodes")
        .then(({data}) => {
            if (data.success) {
                nodeResponseLoaded = true;
                nodesResponse = data.result;
                deployerNodes = nodesResponse.filter(node => node.isDeployer);
            }
        })
        .catch((e) => {
            console.log("error checkActiveNodes: " + e.message);
            return false;
        });
}

async function getAppStatus(appName) {
    return axios.get(`${GATEWAY_URL}/v1/?app=explorer&method=app&params[appName]=${appName}`)
        .then(({data}) => {
            return data.result;
        })
        .catch(e => {
            throw "get app status request failed: " + e.message
        });
}

async function undeploy(appName) {
    console.log(`Undeploying app: ${appName}`);
    let undeployResp = await axios.get(`${GATEWAY_URL}/v1/?app=deployment&method=undeploy&params[app]=${appName}`)
        .catch(e => {
            throw "undeploy request failed: " + e.message
        });
    undeployResp = undeployResp.data;
    if (!undeployResp.success) {
        console.log(chalk.red(undeployResp.error));
        throw "Undeploy failed: " + undeployResp.error;
    } else {
        console.log(chalk.green("Undeploy successful"));
    }
}

async function deploy(appName) {
    console.log(`Deploying ${appName}`);
    await appCMD.deployApp({app: appName}, DEPLOY_CONFIG);
    console.log(`Deployment command finished.`);
    console.log(`Checking deployment status from explorer app`);
    let appStatus = await getAppStatus(appName);

    if (appStatus.status == "DEPLOYED")
        console.log(chalk.green("App successfully deployed."));
    else {
        console.log(chalk.red(`App not deployed. status: ${appStatus.status}`));
        throw "deploy failed";
    }
}

async function loadAppContext(appId, targetIp) {
    if (!targetIp)
        targetIp = getRandomDeployerIp();
    console.log(`Query app context from ${targetIp}`);
    let result = await p2pClient.call({
        ip: targetIp,
        "method": "AppManager.get-app-context",
        "params": appId
    })
        .catch(e => {
            console.log(chalk.red(`load context failed from: ${targetIp}`));
            throw "load context failed: " + e.message
        });
    let context = result.response;
    console.log(chalk.green("context load successful"));
    return context;
}

async function loadContextFromNodes(appId, partners) {
    console.log("Loading context directly from nodes...");
    console.log("Nodes:");
    console.log(partners);
    let promises = [];
    partners.forEach(partner => {
        promises.push(new Promise(async (resolve, reject) => {
            let reqObj = {
                id: partner,
                "method": "AppManager.get-app-context",
                "params": appId
            };
            let result = await
                p2pClient.call(reqObj)
                    .catch(e => {
                        console.log(chalk.red(`load context failed from peer: ${partner}`));
                        reject(e);
                        throw "load context failed: " + e.message;
                    });
            let resp = {partner, result: false, response: result};

            if (result?.response?.appId == appId)
                resp.result = true;
            resolve(resp);
        }))
    });
    let responses = await Promise.all(promises);
    let total = 0;
    let success = 0;
    let fail = 0;
    responses.forEach(response => {
        total++;
        if (response.result) {
            success++;
            console.log(chalk.green(`Node ID ${response.partner}: Success`));
        } else {
            fail++;
            console.log(chalk.red(`Node ID ${response.partner}: Failed`));
        }
    });

    console.log(`Load context: Total:${total} Success:${success} Fail:${fail}`);
    return fail;
}

async function execRequestOnPartyNodes(appName, partners) {
    console.log("Sending sign request to partners");
    let promises = [];
    partners.forEach(partner => {
        promises.push(new Promise(async (resolve, reject) => {
            let reqObj = {
                id: partner,
                method: "NetworkIpcHandler.exec-gateway-request",
                params: {
                    app: appName,
                    method: "test",
                    params: {},
                    mode: "sign"
                }
            };
            let result = await
                p2pClient.call(reqObj)
                    .catch(e => {
                        console.log(chalk.red(`${partner}: Exec app request failed`));
                        reject(e);
                        throw "load context failed: " + e.message;
                    });
            let resp = {partner, result: false};
            if (result.error) {
                console.log(chalk.red(`Node ID ${partner}: ${result.error.message}`));
            } else {
                console.log(chalk.green(`Node ID ${partner}: Exec app request success`));
                resp.result = true;
            }

            resolve(resp);
        }))
    });
    let responses = await Promise.all(promises);
    let total = 0;
    let success = 0;
    let fail = 0;
    responses.forEach(response => {
        total++;
        if (response.result) {
            success++;
        } else {
            fail++;
        }
    });

    console.log(`Sign requests: Total:${total} Success:${success} Fail:${fail}`);
    return fail;
}

async function checkContextOnAllDeployers() {
    let appStatus = await getAppStatus(APP_NAME);
    let appId = appStatus.appId;
    console.log("Checking context on all deployers");

    let promises = [];
    deployerNodes.forEach(node => {
        promises.push(new Promise(async (resolve, reject) => {
            let context = await loadAppContext(appId, node.ip)
                .catch(e => {
                    reject(e);
                });
            resolve({ip: node.ip, context});
        }))
    });
    let responses = await Promise.all(promises);
    let deploymentReqId = responses[0].context.deploymentRequest.reqId;

    let allEqual = true;
    responses.forEach(response => {
        if (deploymentReqId == response.context.deploymentRequest.reqId)
            console.log(chalk.green(`${response.ip}: context verified`));
        else {
            console.log(chalk.red(`${response.ip}: context failed`));
            allEqual = false;
        }
    });

    return allEqual;
}

async function getAppParty() {
    let appStatus = await getAppStatus(APP_NAME);
    let context = await loadAppContext(appStatus.appId);
    return context.party.partners
}

function getRandomDeployerIp() {
    let index = Math.floor(Math.random() * deployerNodes.length);
    return deployerNodes[index].ip;
}