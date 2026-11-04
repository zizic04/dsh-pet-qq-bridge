import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PetClient, localOrigin } from '../src/pet-client.js';
import { Bridge } from '../src/bridge.js';

test('拒绝远端地址、携带凭据的 URL 和路径覆盖', () => {
  for (const url of ['http://example.com', 'http://127.0.0.1.evil.test', 'file:///tmp/x', 'http://u:p@localhost', 'http://localhost/x', 'http://localhost?token=x']) assert.throws(() => localOrigin(url));
  assert.equal(localOrigin('http://127.0.0.1:1234'), 'http://127.0.0.1:1234');
  assert.equal(localOrigin('http://[::1]:1234'), 'http://[::1]:1234');
});

test('HTTP 合约集成：桌面→QQ→桌面共用一个宠物后端；携带 surface 且状态读取 0 轮', async t => {
  const history = [], requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); requests.push({ method: req.method, url });
    assert.equal(url.pathname, '/dsh-pet-7340/chat'); assert.equal(url.searchParams.get('pet'), 'fish');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ ok: true, rounds: 0, messages: [] }));
    assert.equal(url.searchParams.get('surface'), 'any');
    let body = ''; for await (const chunk of req) body += chunk;
    const { text } = JSON.parse(body);
    const answer = history.some(item => item === '我叫小鱼') ? '你叫小鱼' : '记住了';
    history.push(text); res.end(JSON.stringify({ ok: true, text: answer }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const desktop = new PetClient({ origin, petId: 'fish' });
  const phone = new PetClient({ origin, petId: 'fish' });
  await desktop.chat('我叫小鱼');
  const sent = [];
  const bridge = new Bridge({ ownerOpenId: 'owner', pet: phone, send: async (_target, text) => sent.push(text) });
  await bridge.handle({ kind: 'c2c', senderId: 'owner', messageId: '1', content: '我叫什么' });
  assert.equal(sent[0], '你叫小鱼');
  assert.equal(await desktop.chat('再说一次'), '你叫小鱼');
  await phone.check(); assert.equal(requests.at(-1).url.searchParams.get('rounds'), '0');
  assert.deepEqual(history, ['我叫小鱼', '我叫什么', '再说一次']);
});

test('200 业务错误、无效 JSON、空回复、HTTP 错误均被拒绝', async () => {
  for (const [response, code] of [
    [Response.json({ ok: false, reason: 'unknown-pet', message: 'private' }), 'unknown-pet'],
    [Response.json({ ok: false, reason: 'secret-details' }), 'pet-error'],
    [new Response('<html>oops</html>'), 'invalid-response'],
    [Response.json({ ok: true, text: '' }), 'invalid-response'],
    [new Response('private', { status: 403 }), 'http-403'],
  ]) {
    const pet = new PetClient({ origin: 'http://127.0.0.1', petId: 'fish', fetchImpl: async () => response });
    await assert.rejects(() => pet.chat('hi'), error => error.code === code && !error.message.includes('private'));
  }
});

test('禁用重定向并设置超时信号；不自动重试', async () => {
  let calls = 0;
  const pet = new PetClient({ origin: 'http://127.0.0.1', petId: 'fish', fetchImpl: async (_url, options) => {
    calls++; assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    throw new DOMException('timeout', 'TimeoutError');
  } });
  await assert.rejects(() => pet.chat('hi'), error => error.code === 'timeout'); assert.equal(calls, 1);
});
