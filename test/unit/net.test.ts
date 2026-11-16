import { describe, expect, it } from 'vitest';
import {
  formatHostForUrl,
  getAllIPv4,
  isLoopbackHost,
  isWildcardHost,
  listDisplayAddresses,
  type NetworkInterfaces,
} from '../../src/utils/net';

function ifaces(
  entries: Record<string, { address: string; internal?: boolean; family?: string }[]>,
): NetworkInterfaces {
  const result: Record<string, unknown[]> = {};
  for (const [name, list] of Object.entries(entries)) {
    result[name] = list.map((item) => ({
      address: item.address,
      family: item.family ?? 'IPv4',
      internal: item.internal ?? false,
      netmask: '255.255.255.0',
      mac: '00:00:00:00:00:00',
      cidr: `${item.address}/24`,
    }));
  }
  return result as unknown as NetworkInterfaces;
}

describe('getAllIPv4', () => {
  it('过滤回环与 IPv6，并去重', () => {
    const result = getAllIPv4(
      ifaces({
        lo: [{ address: '127.0.0.1', internal: true }],
        eth0: [{ address: '10.0.0.7' }, { address: 'fe80::1', family: 'IPv6' }],
        wlan0: [{ address: '10.0.0.7' }],
      }),
    );

    expect(result).toEqual(['10.0.0.7']);
  });

  it('192.168 网段排在前面', () => {
    const result = getAllIPv4(
      ifaces({
        eth0: [{ address: '172.16.0.9' }, { address: '10.1.2.3' }, { address: '192.168.1.20' }],
      }),
    );

    expect(result).toEqual(['192.168.1.20', '10.1.2.3', '172.16.0.9']);
  });

  it('没有可用地址时返回空数组', () => {
    expect(getAllIPv4(ifaces({ lo: [{ address: '127.0.0.1', internal: true }] }))).toEqual([]);
  });
});

describe('listDisplayAddresses', () => {
  it('没有外网地址时回落到 127.0.0.1', () => {
    expect(listDisplayAddresses(ifaces({}))).toEqual(['127.0.0.1']);
  });
});

describe('host 判定', () => {
  it('识别通配地址', () => {
    expect(isWildcardHost('0.0.0.0')).toBe(true);
    expect(isWildcardHost('::')).toBe(true);
    expect(isWildcardHost('127.0.0.1')).toBe(false);
  });

  it('识别回环地址', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('192.168.1.2')).toBe(false);
  });
});

describe('formatHostForUrl', () => {
  it('IPv6 加方括号', () => {
    expect(formatHostForUrl('::1')).toBe('[::1]');
  });

  it('IPv4 原样返回', () => {
    expect(formatHostForUrl('127.0.0.1')).toBe('127.0.0.1');
  });
});
