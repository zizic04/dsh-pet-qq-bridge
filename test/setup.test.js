import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDocument } from 'yaml';
import { patchPet, hasPatch } from '../src/patch-pet.js';
import { configureProfile } from '../src/configure-profile.js';

test('兼容补丁幂等、可恢复，拒绝覆盖补丁后被改动的文件', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pet-patch-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'lib'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-pet', version: '0.3.8' }));
  const original = 'async function chat() {\n\t\tconst generated = await generateChat(ctx, system, list, text, pool, configuredModel(found.conf, "chatModel"));\n\t\tawait writeMemory(mem);\n\t\tstate.writePet(petId, "say", generated.image ? {text: generated.text} : {});\n}';
  const file = join(dir, 'lib/index.js'); await writeFile(file, original);
  await patchPet(dir); assert.equal(await hasPatch(dir), true);
  const patched = await readFile(file, 'utf8'); assert.doesNotThrow(() => new Function(patched));
  assert.match(await patchPet(dir), /已存在/);
  await writeFile(file, patched + '\n// changed');
  await assert.rejects(() => patchPet(dir, true), /拒绝/);
  await writeFile(file, patched); await patchPet(dir, true);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('配置器保留其他插件和官方凭据，不把凭据复制到桥接配置', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pet-configure-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'cordis.patch.yml');
  await writeFile(path, '# keep comment\n- id: other\n  config:\n    value: !!js originalExpression\n- id: im-qqbot\n  config:\n    appId: "123"\n    appSecret: example-secret\n    access:\n      c2cMode: allowlist\n      c2cAllow: [owner]\n');
  await configureProfile(dir, 'main');
  const written = await readFile(path, 'utf8'); assert.match(written, /keep comment/); assert.match(written, /!!js originalExpression/);
  const rows = parseDocument(written, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] }).toJS();
  const bridge = rows.find(row => row.id === 'dsh-pet-qq-bridge');
  assert.deepEqual(bridge.config, { enabled: true, qqProfileDir: dir, petId: 'main' });
  assert.equal(rows.find(row => row.id === 'im-qqbot').config.appSecret, 'example-secret');
});
