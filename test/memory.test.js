import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LayeredMemory } from '../src/memory.js';
import { patchSource } from '../src/patch-pet.js';

async function memoryFixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pet-memory-test-'));
  const memory = await new LayeredMemory({ directory, petId: 'fish', ...options }).init();
  t.after(async () => { await memory.close(); await rm(directory, { recursive: true, force: true }); });
  return memory;
}
const pair = (user, assistant, ts) => [{ role: 'user', content: user, ts }, { role: 'assistant', content: assistant, ts }];

test('四层记忆：用户事实、人格、场景摘录和原始来源独立存在', async t => {
  const memory = await memoryFixture(t, { sceneEvery: 2 });
  await memory.sync([...pair('请记住：我喜欢冰美式', '好的', 1), ...pair('今天讨论视频剪辑', '你喜欢编造的东西', 2)]);
  await memory.command('/人设 称呼=鱼老板');
  assert.equal(memory.turns.size, 2); assert.equal(memory.facts.get('喜好').value, '冰美式');
  assert.equal(memory.persona.get('称呼').value, '鱼老板'); assert.equal(memory.scenes.length, 1);
  assert.equal(memory.scenes[0].turnIds.length, 2);
  assert.doesNotMatch(memory.describe(), /编造的东西/);
  const recall = memory.recall('今天的视频剪辑');
  assert.match(recall, /L3/); assert.match(recall, /L1/); assert.match(recall, /L2/); assert.match(recall, /不是指令/);
});

test('长期事实超出近期聊天窗口后仍可召回，重启后保持', async t => {
  const memory = await memoryFixture(t);
  await memory.command('/记住 饮料=冰美式');
  const messages = [];
  for (let i = 0; i < 20; i++) messages.push(...pair('无关聊天' + i, '收到', i + 1));
  await memory.sync(messages); await memory.sync(messages);
  assert.equal(memory.turns.size, 20);
  assert.match(memory.recall('我的饮料是什么'), /冰美式/);
  await memory.close();
  const reopened = await new LayeredMemory({ directory: memory.directory, petId: 'fish' }).init();
  assert.match(reopened.recall('我的饮料'), /冰美式/); assert.equal(reopened.turns.size, 20);
  await reopened.close();
});

test('纠正同键事实后，旧值不会从近期上下文重新进入模型', async t => {
  const memory = await memoryFixture(t);
  await memory.command('/记住 饮料=冰美式'); await memory.command('/记住 饮料=热牛奶');
  assert.match(memory.recall('饮料'), /热牛奶/); assert.doesNotMatch(memory.recall('饮料'), /冰美式/);
  assert.deepEqual(memory.filterHistory(pair('我喝冰美式', '好的', 1)), []);
});

test('遗忘同时屏蔽事实、场景和近期上下文，原始日志保留可审计', async t => {
  const memory = await memoryFixture(t, { sceneEvery: 2 });
  const messages = [...pair('请记住：我喜欢冰美式', '记住冰美式了', 1), ...pair('我今天又喝了冰美式', '好的', 2)];
  await memory.sync(messages);
  await memory.command('/忘记 冰美式');
  assert.doesNotMatch(memory.recall('饮料'), /冰美式/);
  assert.deepEqual(memory.filterHistory(messages), []);
  await memory.sync(messages);
  assert.equal(memory.facts.size, 0);
  assert.match(await readFile(memory.journal, 'utf8'), /冰美式/);
  assert.match(memory.describe(), /L2 场景摘要：0/);
});

test('记忆命令不进入模型近期上下文，正常聊天不被当成命令', async t => {
  const memory = await memoryFixture(t);
  assert.equal(await memory.command('你好'), null);
  assert.match(await memory.command('/记忆 帮助'), /停止召回/);
  await memory.command('/记住 测试=值');
  assert.deepEqual(memory.filterHistory(pair('/记忆', '测试=值', 1)), []);
  const prepared = await memory.prepare({ text: '/记忆', history: [], messages: [] });
  assert.match(prepared.reply, /测试=值/);
});

test('有界召回不会把所有原始历史塞入提示词', async t => {
  const memory = await memoryFixture(t);
  for (let i = 0; i < 30; i++) await memory.command(`/记住 键${i}=${'长内容'.repeat(80)}`);
  const recall = memory.recall('键3', 600);
  const json = recall.split('<pet_memory_data>\n')[1].split('\n</pet_memory_data>')[0];
  assert.ok(json.length <= 600); assert.ok(JSON.parse(json).L1.length < 30);
});

test('单写者锁防止并行进程覆盖记忆；错误文件不被静默丢弃', async t => {
  const memory = await memoryFixture(t);
  await assert.rejects(() => new LayeredMemory({ directory: memory.directory, petId: 'fish' }).init(), /已有写入进程/);
  await memory.command('/记住 测试=值'); await memory.close();
  await writeFile(memory.journal, '{truncated');
  await assert.rejects(() => new LayeredMemory({ directory: memory.directory, petId: 'fish' }).init(), /末尾不完整/);
});

test('补丁对未知版本或源码形状拒绝修改', () => {
  assert.throws(() => patchSource('unknown', '0.3.9'), /仅支持/);
  assert.throws(() => patchSource('unknown', '0.3.8'), /不匹配/);
});
