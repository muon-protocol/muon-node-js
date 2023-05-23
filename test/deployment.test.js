import axios from 'axios'
import * as appCMD from '../src/cmd/modules/cmd-app-mod.ts'
import * as utils from './utils.js'
import * as config from './config.js'
import chalk from 'chalk'
import assert from "assert"
import * as p2pClient from "./Libp2pClient.js"







describe('Deployment process', async function () {
    this.timeout(5 * 60000);
    before(async () => {
        await utils.loadNodes();
    });

    describe('Deployment scenario', function () {
        it("Before deploy, app should be undeployed and app status should be NEW", async () => {
            let appStatus = await utils.getAppStatus(config.APP_NAME);
            if (appStatus.status != "NEW")
                await undeploy(config.APP_NAME);
            appStatus = await utils.getAppStatus(config.APP_NAME);
            assert.equal(appStatus.status, "NEW");
        });
        it("After deployment request, app status should be DEPLOYED", async () => {
            await deploy(config.APP_NAME);
            let appStatus = await utils.getAppStatus(config.APP_NAME);
            assert.equal(appStatus.status, "DEPLOYED");
        });
        it('App context should be available and equal on all deployers', async () => {
            let compareResult = await checkContextOnAllDeployers();
            assert.equal(compareResult, true);
        });
        it('App context should be available all party nodes', async () => {
            let appStatus = await utils.getAppStatus(config.APP_NAME);
            let context = await utils.loadAppContext(appStatus.appId, utils.getRandomDeployerIp());
            let failedNodes = await loadContextFromNodes(appStatus.appId, context.party.partners);
            assert.equal(failedNodes, 0);
        });
        it('All party nodes should be able to execute and sign app requests', async () => {
            let party = await getAppParty();
            let failedNodes = await execRequestOnPartyNodes(config.APP_NAME, party);
            assert.equal(failedNodes, 0);
        });
    });

    describe('Redeploy scenario', function () {
        let appStatus;
        it('App status should be deployed', async () => {
            appStatus = await utils.getAppStatus(config.APP_NAME);
            if (appStatus.status != "DEPLOYED")
                await deploy(config.APP_NAME);
            appStatus = await utils.getAppStatus(config.APP_NAME);
            assert.equal(appStatus.status, "DEPLOYED");
        });

        let context1, context2;
        it('First context should be available on deployers', async () => {
            context1 = await utils.loadAppContext(appStatus.appId, utils.getRandomDeployerIp());
            assert.notEqual(context1, null);
        });

        it('After undeploy, app status should be NEW', async () => {
            await undeploy(config.APP_NAME);
            appStatus = await utils.getAppStatus(config.APP_NAME);
            assert.equal(appStatus.status, "NEW");
        });

        it('Context should be removed from deployers', async () => {
            let appStatus = await utils.getAppStatus(config.APP_NAME);
            let deployerNodeIds = utils.deployerNodes.map(node => node.id);
            let failedNodes = await loadContextFromNodes(appStatus.appId, deployerNodeIds);
            assert.equal(failedNodes, deployerNodeIds.length);
        });

        it('After deploy, app status should be DEPLOYED', async () => {
            await deploy(config.APP_NAME);
            appStatus = await utils.getAppStatus(config.APP_NAME);
            assert.equal(appStatus.status, "DEPLOYED");
        });

        it('Second context should be available on deployers', async () => {
            context2 = await utils.loadAppContext(appStatus.appId, utils.getRandomDeployerIp());
            assert.notEqual(context2, null);
        });

        it('First and second context should not be equal', async () => {
            context2 = await utils.loadAppContext(appStatus.appId, utils.getRandomDeployerIp());
            assert.notEqual(context1.deploymentRequest.reqId, context2.deploymentRequest.reqId);
        });

    });

});




async function undeploy(appName) {
    console.log(`Undeploying app: ${appName}`);
    let undeployResp = await axios.get(`${config.GATEWAY_URL}/v1/?app=deployment&method=undeploy&params[app]=${appName}`)
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
    await appCMD.deployApp({app: appName}, config.DEPLOY_CONFIG);
    console.log(`Deployment command finished.`);
    console.log(`Checking deployment status from explorer app`);
    let appStatus = await utils.getAppStatus(appName);

    if (appStatus.status == "DEPLOYED")
        console.log(chalk.green("App successfully deployed."));
    else {
        console.log(chalk.red(`App not deployed. status: ${appStatus.status}`));
        throw "deploy failed";
    }
}

async function loadContextFromNodes(appId, partners) {
    console.log("Loading context directly from nodes...");
    console.log("Nodes:");
    console.log(partners);
    let promises = [];
    partners.forEach(partner => {
        promises.push(new Promise(async (resolve, reject) => {
            let result = await
                utils.loadAppContext(appId, null, partner)
                    .catch(e => {
                        console.log(chalk.red(`load context failed from peer: ${partner}`));
                        reject(e);
                    });
            let resp = {partner, result: false, response: result};

            if (result?.appId == appId)
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
                method: "NetworkIpcHandler.forward-gateway-request",
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
                        // console.log(chalk.red(`${partner}: Exec app request failed ${e.message}`));
                        return {error: e};
                    });
            let resp = {partner, result: false};
            if (result?.response?.data) {
                console.log(chalk.green(`Node ID ${partner}: Exec app request success`));
                resp.result = true;
            } else {
                console.log(chalk.red(`Node ID ${partner}: Exec app request failed. error: ${result?.error?.message}`));
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
    let appStatus = await utils.getAppStatus(config.APP_NAME);
    let appId = appStatus.appId;
    console.log("Checking context on all deployers");

    let promises = [];
    utils.deployerNodes.forEach(node => {
        promises.push(new Promise(async (resolve, reject) => {
            let context = await utils.loadAppContext(appId, node.ip)
                .catch(e => {
                    reject(e);
                });
            resolve({ip: node.ip, context});
        }))
    });
    let responses = await Promise.all(promises);
    let deploymentReqId;

    let allEqual = true;
    responses.forEach(response => {
        let currentDeploymetReqId = response.context?.deploymentRequest.reqId;
        if (!deploymentReqId)
            deploymentReqId = currentDeploymetReqId;
        if (currentDeploymetReqId && deploymentReqId == currentDeploymetReqId)
            console.log(chalk.green(`${response.ip}: context verified`));
        else {
            console.log(chalk.red(`${response.ip}: context failed`));
            allEqual = false;
        }
    });

    return allEqual;
}

async function getAppParty() {
    let appStatus = await utils.getAppStatus(config.APP_NAME);
    let context = await utils.loadAppContext(appStatus.appId, utils.getRandomDeployerIp());
    return context.party.partners
}

