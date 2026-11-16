import os from 'node:os';

export type NetworkInterfaces = ReturnType<typeof os.networkInterfaces>;

/** 机器上所有非回环的 IPv4 地址：192.168.x 优先，其次 10.x，再其次其它 */
export function getAllIPv4(ifaces: NetworkInterfaces = os.networkInterfaces()): string[] {
  const addresses: string[] = [];

  for (const details of Object.values(ifaces)) {
    if (details === undefined) continue;
    for (const detail of details) {
      if (detail.family === 'IPv4' && !detail.internal) {
        addresses.push(detail.address);
      }
    }
  }

  return [...new Set(addresses)].toSorted(compareIPv4);
}

function privateRank(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  return 2;
}

function compareIPv4(left: string, right: string): number {
  return privateRank(left) - privateRank(right) || left.localeCompare(right);
}

/** 用于展示的地址列表：没有外网地址时回落到 127.0.0.1 */
export function listDisplayAddresses(ifaces?: NetworkInterfaces): string[] {
  const external = getAllIPv4(ifaces);
  return external.length > 0 ? external : ['127.0.0.1'];
}

export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]' || host === '';
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

/** IPv6 在 URL 里必须加方括号 */
export function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
