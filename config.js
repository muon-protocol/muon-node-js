import * as fs from "fs";
import * as dotenv from "dotenv";

const _restore = (keys) => {
  let env = fs.readFileSync(".env.testnet", "utf8");
  env = env.replace("__SIGN_WALLET_ADDRESS__", keys.SIGN_WALLET_ADDRESS);
  env = env.replace(
    "__SIGN_WALLET_PRIVATE_KEY__",
    keys.SIGN_WALLET_PRIVATE_KEY
  );
  env = env.replace("__PEER_ID__", keys.PEER_ID);
  env = env.replace("__PEER_PUBLIC_KEY__", keys.PEER_PUBLIC_KEY);
  env = env.replace("__PEER_PRIVATE_KEY__", keys.PEER_PRIVATE_KEY);
  fs.writeFileSync(".env", env);
  console.log(".env created successfully.");
};

const restore = () => {
  let keys = process.argv[3];
  if (!keys) {
    console.error("keys not found!");
    process.exit(0);
  }
  try {
    keys = JSON.parse(keys);
  } catch (e) {
    console.error("keys are not a valid json!");
    process.exit(0);
  }
  _restore(keys);
};

const restore_file = () => {
  const fname = process.argv[3];
  if (!fname) {
    console.error("filename not found!");
    process.exit(0);
  }
  if (!fs.existsSync(fname)) {
    console.error(`file ${fname} not found!`);
    process.exit(0);
  }
  const backup = fs.readFileSync(fname, "utf8");
  const buf = Buffer.from(backup);
  const keys = dotenv.parse(buf);
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
  const keys = JSON.stringify(vars).replaceAll(" ", "");
  console.log(keys);
};

const main = () => {
  const action = process.argv[2];
  if (action == "backup") {
    backup();
  } else if (action == "restore") {
    restore();
  } else if (action == "restore-file") {
    restore_file();
  } else if (action) {
    console.error(
      `"${action}" is not a valid action! valid actions: backup, resotre, restore-file.`
    );
  } else {
    console.error(`action not found! valid actions: backup, resotre.`);
  }
};

main();
