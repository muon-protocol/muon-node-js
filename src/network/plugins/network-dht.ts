import BaseNetworkPlugin from "./base/base-network-plugin.js";
import CollateralInfoPlugin from "./collateral-info.js";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import Log from "../../common/muon-log.js";
import { peerId2Str } from "../utils.js";
import last from "it-last";
import drain from "it-drain";

const log = Log("muon:network:plugins:dht");

export default class NetworkDHTPlugin extends BaseNetworkPlugin {
  async onStart() {
    await super.onStart();
    log("dht plugin started.");
  }

  async put(key, data) {
    await drain(
      this.network.libp2p.dht.put(
        uint8ArrayFromString(key),
        uint8ArrayFromString(data)
      )
    );
  }

  async get(key) {
    let ret: { value: Uint8Array } | undefined = await last(
      this.network.libp2p.dht.get(uint8ArrayFromString(key))
    );
    return ret?.value ? uint8ArrayToString(ret?.value) : null;
  }
}