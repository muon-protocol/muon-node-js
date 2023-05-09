import type { Multiaddr } from "@multiformats/multiaddr";
import isIpPrivate from "private-ip";
import { PeerId } from "./types";

/**
 * This function checks if a given
 * multiaddress is private or not.
 */
export function isPrivate(ma: Multiaddr) {
  const { address } = ma.nodeAddress();
  return Boolean(isIpPrivate(address));
}

export function peerId2Str(peerId: PeerId): string {
  return peerId.toString();
}
