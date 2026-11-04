import Schema from '@deepseek-ai/schemastery';
import { resolveConfig } from './config.js';
import { startBridge } from './runtime.js';
import { LayeredMemory } from './memory.js';
import { HOOK_KEY, hasPatch } from './patch-pet.js';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export const name = 'dsh-pet-qq-bridge';
export const inject = ['webServer'];
export const Config = Schema.object({
  enabled: Schema.boolean().default(false).description('完成配置并停用原 QQ 插件后，开启桥接'),
  qqProfileDir: Schema.string().default('').description('可选：已扫码绑定的 DSH profile 绝对目录（只读凭据与唯一私聊白名单）'),
  appId: Schema.string().default('').description('QQ AppID；可留空从指定 profile 或环境变量读取'),
  appSecret: Schema.string().role('secret').default('').description('QQ AppSecret；建议从 profile 或环境变量读取'),
  ownerOpenId: Schema.string().default('').description('唯一主人 OpenID（不是 QQ 号）；留空时只接受 profile 中唯一的私聊白名单成员'),
  petId: Schema.string().default('').description('要共用记忆的宠物 ID，必须与桌面那只完全一致'),
  petPackageDir: Schema.string().default('').description('dsh-pet 包目录；留空从 qqProfileDir/node_modules/dsh-pet 定位'),
  memoryDirectory: Schema.string().default('').description('分层记忆存储目录；留空保存到 DSH_HOME/pet-qq-memory 下'),
  surface: Schema.union(['any', 'desktop', 'web', 'both']).default('any').description('宠物显示端，any 表示任一可见端'),
  timeoutMs: Schema.number().default(120000).description('等待桌宠回复的超时毫秒数'),
  maxQueue: Schema.number().default(3).description('最大待处理 QQ 消息数（包含正在处理的消息）'),
});

export async function apply(ctx, input) {
  if (!input.enabled) return;
  const config = await resolveConfig(input);
  const petPackageDir = input.petPackageDir || (input.qqProfileDir && join(input.qqProfileDir, 'node_modules', 'dsh-pet'));
  if (!petPackageDir || !await hasPatch(petPackageDir)) throw new Error('请先安装并验证 dsh-pet 0.3.8 的分层记忆兼容补丁，再重启 DSH');
  const memoryDirectory = input.memoryDirectory || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'pet-qq-memory', createHash('sha256').update(config.petId).digest('hex').slice(0, 16));
  if (!isAbsolute(memoryDirectory)) throw new Error('memoryDirectory 必须是绝对路径');
  const memory = await new LayeredMemory({ directory: memoryDirectory, petId: config.petId }).init();
  const hookKey = Symbol.for(HOOK_KEY);
  const hooks = globalThis[hookKey] ??= new Map();
  if (hooks.has(config.petId)) { await memory.close(); throw new Error('这只宠物已连接另一个分层记忆实例'); }
  // getOrigin 延迟到请求时读取：插件加载时宿主监听端口可能尚未就绪。
  ctx.effect(() => {
    hooks.set(config.petId, memory);
    const runtime = startBridge(config, { origin: () => ctx.webServer.getOrigin(), logger: ctx.logger ?? console });
    return async () => {
      hooks.delete(config.petId);
      await runtime.stop();
      await memory.close();
    };
  }, 'dsh-pet-qq-bridge.lifecycle');
}
