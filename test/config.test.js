import test from 'node:test';
import assert from 'node:assert/strict';
import { readBindingYaml, resolveConfig } from '../src/config.js';
import { Config, apply } from '../src/index.js';
import { startBridge } from '../src/runtime.js';

test('读取官方绑定格式，不执行 !!js；只接受唯一白名单主人', () => {
  const source = '- id: other\n  config:\n    value: !!js process.exit(1)\n- id: im-qqbot\n  config:\n    appId: "123"\n    appSecret: example\n    access:\n      c2cMode: allowlist\n      c2cAllow: [owner]\n';
  assert.deepEqual(readBindingYaml(source), { appId: '123', appSecret: 'example', ownerOpenId: 'owner' });
  assert.equal(readBindingYaml(source.replace('[owner]', '[a, b]')).ownerOpenId, '');
  assert.equal(readBindingYaml(source.replace('allowlist', 'open')).ownerOpenId, '');
  assert.throws(() => readBindingYaml('- id: im-qqbot\n- id: im-qqbot'));
});

test('缺少主人配置时拒绝启动，环境变量可配置凭据', async () => {
  await assert.rejects(() => resolveConfig({ petId: 'fish' }, { QQBOT_APPID: '1', QQBOT_SECRET: 'example' }), /ownerOpenId/);
  const cfg = await resolveConfig({ petId: 'fish' }, { QQBOT_APPID: '1', QQBOT_SECRET: 'example', QQ_PET_OWNER_OPENID: 'owner' });
  assert.equal(cfg.ownerOpenId, 'owner');
  await assert.rejects(() => resolveConfig({ ...cfg, maxQueue: 0 }, {}), /maxQueue/);
});

test('Cordis schema 可加载，插件默认不启动', async () => {
  const input = Config({}); assert.equal(input.enabled, false);
  await apply({ effect() { throw Error('未配置不应启动'); } }, input);
});

test('QQ SDK 适配器注册真实事件形状，释放时关闭连接', async () => {
  let instance;
  class FakeBot {
    constructor(config) { this.config = config; this.handlers = {}; instance = this; }
    on(name, handler) { this.handlers[name] = handler; }
    async start() {}
    stop() { this.stopped = true; }
    async sendText(target, text) { this.sent = { target, text }; }
  }
  const runtime = startBridge({ appId: '1', appSecret: 'example', ownerOpenId: 'owner', petId: 'fish', petBaseUrl: 'http://127.0.0.1' }, { Bot: FakeBot });
  await instance.handlers.message({ message: { kind: 'c2c', senderId: 'owner', messageId: 'id', content: '/pet-help' } });
  assert.match(instance.sent.text, /共用/); await runtime.stop(); assert.equal(instance.stopped, true);
});
