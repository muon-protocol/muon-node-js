const { muonSha3 } = MuonAppUtils

const LOCK_DURATION = 24 * 60 * 60;

const VRFApp = {
  APP_NAME: "vrf2",

  hashParams: function(request) {
    let {
      chainId,
      requestId,
      blockNum,
      callbackGasLimit,
      numWords,
      consumer,
    } = request.data.params;

    return muonSha3(
      { type: "uint256", value: chainId },
      { type: "uint256", value: requestId },
      { type: "uint256", value: blockNum },
      { type: "uint32", value: callbackGasLimit },
      { type: "uint32", value: numWords },
      { type: "address", value: consumer },
    );
  },

  onArrive: async function (request) {
    let {
      method,
      deploymentSeed,
    } = request;

    switch (method) {
      case "random-number": {
        const hash = this.hashParams(request)
        let memory = await this.readGlobalMem(`vrf-lock-${hash}`);
        if (memory) {
          throw { message: `The random already generated and locked for a while.` };
        }
        await this.writeGlobalMem(`vrf-lock-${hash}`, deploymentSeed, LOCK_DURATION);
      }
    }
  },

  onRequest: async function (request) {
    let {
      method,
      deploymentSeed,
      gwAddress,
      data: { params },
    } = request;
    switch (method) {
      case "random-number":
        let {
          chainId,
          requestId,
          blockNum,
          callbackGasLimit,
          numWords,
          consumer,
        } = params;

        const hash = this.hashParams(request);

        const memory = await this.readGlobalMem(`vrf-lock-${hash}`)
        if(!memory)
          throw `Global lock not performed`
        if(memory.owner !== gwAddress || memory.value !== deploymentSeed)
          throw { 
            message: `Error when checking lock`,
            memory,
            gwAddress,
            deploymentSeed,
          }

        await this.writeLocalMem(`vrf-local-lock-${hash}`, "locked", LOCK_DURATION, {preventRewrite: true})

        return {
          chainId,
          requestId,
          blockNum,
          callbackGasLimit,
          numWords,
          consumer,
        };

      default:
        throw { message: `invalid method ${method}` };
    }
  },

  signParams: function (request, result) {
    switch (request.method) {
      case "random-number": {
        let {
          chainId,
          requestId,
          blockNum,
          callbackGasLimit,
          numWords,
          consumer,
        } = result;

        return [
          { type: "uint256", value: chainId },
          { type: "uint256", value: requestId },
          { type: "uint256", value: blockNum },
          { type: "uint32", value: callbackGasLimit },
          { type: "uint32", value: numWords },
          { type: "address", value: consumer },
        ];
      }

      default:
        throw { message: `Unknown method: ${request.method}` };
    }
  },
};

module.exports = VRFApp;
