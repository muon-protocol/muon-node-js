import type { Multiaddr } from '@multiformats/multiaddr'
import isIpPrivate from 'private-ip'
import {PeerId} from './types'

/**
 * Check if a given multiaddr has a private address.
 */
export function isPrivate (ma: Multiaddr) {
  const { address } = ma.nodeAddress()

  return Boolean(isIpPrivate(address))
}

export function peerId2Str(peerId: PeerId): string {
  return peerId.toString()
}

