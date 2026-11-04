import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { Bridge } from './bridge.js';
import { PetClient } from './pet-client.js';

export function startBridge(config, { origin, logger = console, Bot = QQBot } = {}) {
  // SDK 日志可能含请求内容，只输出类别，避免输出聊天正文与凭据。
  const sdkLogger = {
    debug() {}, info() {},
    warn() { logger.warn('QQ SDK 警告，请检查连接状态。'); },
    error() { logger.error('QQ SDK 错误，请检查连接和机器人凭据。'); },
  };
  const bot = new Bot({ appId: config.appId, appSecret: config.appSecret, transport: 'websocket', logger: sdkLogger });
  const pet = new PetClient({ origin: origin ?? config.petBaseUrl, ...config });
  const bridge = new Bridge({ ownerOpenId: config.ownerOpenId, pet, maxQueue: config.maxQueue,
    send: (target, text) => bot.sendText(target, text), logger });
  bot.on('message', context => bridge.handle(context.message));
  bot.on('error', () => logger.error('QQ 连接异常，SDK 将按连接策略处理。'));
  bot.on('ready', () => logger.info('QQ 已连接：仅允许指定主人私聊，共用桌宠记忆。'));
  bot.on('disconnected', event => logger.warn(event.willReconnect ? 'QQ 断线，正在重连。' : 'QQ 连接已停止，请检查配置后重启。'));
  const started = bot.start().catch(() => { logger.error('QQ 启动失败，请检查机器人凭据、网络及是否有重复运行的 QQ 插件。'); });
  return { bot, bridge, started, async stop() { bot.stop(); await bridge.close(); } };
}
