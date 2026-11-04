import test from 'node:test';
import assert from 'node:assert/strict';
import { Bridge } from '../src/bridge.js';
import { PetError } from '../src/pet-client.js';

const message = (id, content = '你好', extra = {}) => ({ kind: 'c2c', senderId: 'owner', messageId: id, content, ...extra });
function fixture(options = {}) {
  const calls = [], sent = [];
  const bridge = new Bridge({ ownerOpenId: 'owner', pet: { chat: async text => { calls.push(text); return '鱼：' + text; }, check: async () => {} },
    send: async (target, text) => { sent.push({ target, text }); }, ...options });
  return { bridge, calls, sent };
}

test('主人私聊调用桌宠并使用原消息 ID 被动回复', async () => {
  const { bridge, calls, sent } = fixture();
  await bridge.handle(message('1'));
  assert.deepEqual(calls, ['你好']);
  assert.deepEqual(sent, [{ target: { scope: 'c2c', targetId: 'owner', msgId: '1' }, text: '鱼：你好' }]);
});

test('群、频道、陌生人、机器人和缺少消息 ID 的请求不会读取记忆或回复', async () => {
  const { bridge, calls, sent } = fixture({ pet: { chat() { throw Error('不应调用'); }, check() { throw Error('不应调用'); } } });
  for (const extra of [{ kind: 'group' }, { kind: 'guild' }, { kind: 'dm' }, { senderId: 'stranger' }, { senderIsBot: true }, { messageId: '' }]) {
    await bridge.handle(message('1', '/pet-status', extra));
  }
  assert.equal(calls.length + sent.length, 0);
});

test('并发重复消息只写入一次，后续消息严格排队', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const order = [];
  const { bridge } = fixture({ pet: { async chat(text) { order.push('start:' + text); if (text === 'A') await gate; order.push('end:' + text); return text; } } });
  const a = bridge.handle(message('1', 'A'));
  const duplicate = bridge.handle(message('1', 'A'));
  const b = bridge.handle(message('2', 'B'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['start:A']); release();
  await Promise.all([a, b, duplicate]);
  assert.deepEqual(order, ['start:A', 'end:A', 'start:B', 'end:B']);
  assert.equal(bridge.pending, 0);
});

test('队列满时明确拒绝，不送入桌宠', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const { bridge, sent } = fixture({ maxQueue: 1, pet: { chat: async () => { await gate; return '好'; } } });
  const first = bridge.handle(message('1'));
  await bridge.handle(message('2'));
  assert.match(sent[0].text, /队列已满/); release(); await first;
});

test('附件、过长消息和未知命令不会进入记忆；状态命令只检查接口', async () => {
  const { bridge, calls, sent } = fixture();
  await bridge.handle(message('a', '图', { attachments: [{}] }));
  await bridge.handle(message('b', '字'.repeat(2001)));
  await bridge.handle(message('c', '/new'));
  await bridge.handle(message('d', '/pet-status'));
  assert.equal(calls.length, 0); assert.equal(sent.length, 4);
  assert.match(sent[3].text, /接口正常/);
});

test('发送失败不重新生成，错误日志不含对话正文', async () => {
  let generated = 0; const logs = [];
  const { bridge } = fixture({ pet: { async chat() { generated++; return '隐私正文'; } }, send: async () => { throw Error('secret-token'); }, logger: { warn: text => logs.push(text) } });
  await bridge.handle(message('1')); await bridge.handle(message('1'));
  assert.equal(generated, 1); assert.equal(logs.length, 1);
  assert.doesNotMatch(logs.join(''), /secret-token|隐私正文/);
});

test('超时不会自动重试，也不会回显上游错误信息', async () => {
  let calls = 0;
  const { bridge, sent } = fixture({ pet: { async chat() { calls++; throw new PetError('timeout'); } } });
  await bridge.handle(message('1')); await bridge.handle(message('1'));
  assert.equal(calls, 1); assert.match(sent[0].text, /可能仍在处理/);
});

test('过期排队消息不会生成；停用后不再接收', async () => {
  let now = 0, release; const gate = new Promise(resolve => { release = resolve; }); const calls = [];
  const { bridge, sent } = fixture({ now: () => now, pet: { async chat(text) { calls.push(text); await gate; return '好'; } } });
  const a = bridge.handle(message('1', 'A')); const b = bridge.handle(message('2', 'B'));
  await new Promise(resolve => setImmediate(resolve)); now = 61000; release(); await Promise.all([a, b]);
  assert.deepEqual(calls, ['A']); assert.match(sent[1].text, /等待超过一分钟/);
  await bridge.close(); await bridge.handle(message('3')); assert.equal(calls.length, 1);
});

test('长回复只有一条，Unicode 不截断代理对', async () => {
  const { bridge, sent } = fixture({ pet: { chat: async () => '🐟'.repeat(4000) } });
  await bridge.handle(message('1'));
  assert.equal(sent.length, 1); assert.match(sent[0].text, /完整内容/);
  assert.equal(sent[0].text.includes('\uFFFD'), false);
});
