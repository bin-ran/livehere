import { spawn } from 'node:child_process';

/**
 * 用参数数组调用系统命令，不拼 shell 字符串（避免 host 之类的输入进入 shell）。
 * 打不开浏览器属于「不致命」，静默忽略。
 */
export function openBrowser(url: string): void {
  let command: string;
  let args: string[];

  switch (process.platform) {
    case 'darwin':
      command = 'open';
      args = [url];
      break;
    case 'win32':
      command = 'cmd';
      args = ['/c', 'start', '', url];
      break;
    default:
      command = 'xdg-open';
      args = [url];
  }

  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // 忽略：无桌面环境 / 无 xdg-open
  }
}
