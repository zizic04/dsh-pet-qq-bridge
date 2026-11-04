#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolveConfig } from './config.js';
import { PetClient } from './pet-client.js';

const file = process.argv[2];
if (!file || file.startsWith('-')) {
  console.log('用法：dsh-pet-qq-bridge /绝对路径/bridge.config.json [--check]\n--check 只检查本地桌宠接口，不连接 QQ、不生成对话。');
  process.exitCode = file === '--help' ? 0 : 1;
} else {
  try {
    const config = await resolveConfig(JSON.parse(await readFile(file, 'utf8')));
    const pet = new PetClient({ ...config, origin: config.petBaseUrl });
    await pet.check();
    console.log('桌宠接口检查通过。');
    if (!process.argv.includes('--check')) {
      console.error('分层记忆必须作为 DSH 插件运行，才能同时覆盖桌面和 QQ。此 CLI 仅用于 --check 连通性检查。');
      process.exitCode = 1;
    }
  } catch (error) {
    // 不回显配置和上游响应正文。
    console.error('启动检查失败：', error?.code ?? '请检查配置文件、凭据、主人白名单和桌宠接口。');
    process.exitCode = 1;
  }
}
