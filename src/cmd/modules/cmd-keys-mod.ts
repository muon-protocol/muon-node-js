import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

const ROOT = "./";
const ENV_PATH = path.join(ROOT, ".env");
const ENV_TEMPLATE_PATH = path.join(ROOT, ".env.testnet");

export const command = "keys <action> [value]";

export const describe = "Backup/Restore keys";

export const builder = {
  action: {
    describe: "Backup/Restore keys",
    choices: ["backup", "restore"],
    type: "string",
  },
  value: {
    describe: "Keys in json format or the legacy backed up env file name",
    type: "string",
  },
};

const _restore = (keys) => {
  let env = fs.readFileSync(ENV_TEMPLATE_PATH, "utf8");
  env = env.replace("__SIGN_WALLET_ADDRESS__", keys.SIGN_WALLET_ADDRESS);
  env = env.replace(
    "__SIGN_WALLET_PRIVATE_KEY__",
    keys.SIGN_WALLET_PRIVATE_KEY
  );
  env = env.replace("__PEER_ID__", keys.PEER_ID);
  env = env.replace("__PEER_PUBLIC_KEY__", keys.PEER_PUBLIC_KEY);
  env = env.replace("__PEER_PRIVATE_KEY__", keys.PEER_PRIVATE_KEY);
  fs.writeFileSync(ENV_PATH, env);
  console.log(".env created successfully.");
};

const restore = (argv) => {
  const { value } = argv;
  let keys;
  try {
    keys = JSON.parse(value);
  } catch (e) {
    const fname = path.join(ROOT, value);
    if (!fs.existsSync(fname)) {
      console.error("invalid value");
      return;
    }
    const backup = fs.readFileSync(fname, "utf8");
    const buf = Buffer.from(backup);
    keys = dotenv.parse(buf);
  }
  _restore(keys);
};

const backup = () => {
  dotenv.config();
  const vars = {
    SIGN_WALLET_ADDRESS: "",
    SIGN_WALLET_PRIVATE_KEY: "",
    PEER_ID: "",
    PEER_PUBLIC_KEY: "",
    PEER_PRIVATE_KEY: "",
  };
  Object.keys(vars).forEach((v) => (vars[v] = process.env[v]));
  const keys = JSON.stringify(vars).replace(/ /g, "");
  console.log(keys);
};

export async function handler(argv) {
  switch (argv.action) {
    case "backup": {
      backup();
      break;
    }
    case "restore": {
      restore(argv);
      break;
    }
  }
}
