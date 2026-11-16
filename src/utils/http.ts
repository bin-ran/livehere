import { STATUS_CODES } from 'node:http';
import type { Res } from '../types';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

const NO_BODY_STATUS = new Set([204, 304]);

export function sendStatus(res: Res, status: number, message?: string): true {
  const text = message ?? STATUS_CODES[status] ?? String(status);
  const body = Buffer.from(text, 'utf8');
  res.statusCode = status;

  if (NO_BODY_STATUS.has(status)) {
    res.removeHeader('Content-Type');
    res.end();
    return true;
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', body.byteLength);
  res.end(body);
  return true;
}

export function sendHtml(res: Res, html: string, withBody = true): true {
  const body = Buffer.from(html, 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', body.byteLength);
  res.setHeader('Cache-Control', 'no-store');
  res.end(withBody ? body : undefined);
  return true;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unitIndex]}`;
}
