#!/usr/bin/env node
import { readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, isAbsolute } from 'node:path';
import { parseDocument, isSeq, isMap } from 'yaml';
import { readBindingYaml } from './config.js';

export async function configureProfile(directory, petId) {
  if (!isAbsolute(directory) || !petId || /[\\/\x00-\x1f]/.test(petId)) throw new Error('需要 profile 绝对目录和有效宠物 ID');
  const path = join(directory, 'cordis.patch.yml');
  const before = await readFile(path, 'utf8');
  const binding = readBindingYaml(before);
  if (!binding.appId || !binding.appSecret || !binding.ownerOpenId) throw new Error('先用官方 QQ 插件扫码绑定，并设置唯一私聊白名单主人');
  const doc = parseDocument(before, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] });
  if (doc.errors.length || !isSeq(doc.contents)) throw new Error('profile 格式异常，未修改');
  const rows = doc.contents.items.filter(row => isMap(row) && row.get('id') === 'dsh-pet-qq-bridge');
  if (rows.length > 1) throw new Error('存在重复桥接配置，未修改');
  const entry = rows[0] ?? doc.createNode({ id: 'dsh-pet-qq-bridge' });
  if (entry.anchor) throw new Error('配置存在共享锚点，未修改');
  let config = entry.get('config', true);
  if (config && (!isMap(config) || config.anchor)) throw new Error('配置不是独立映射，未修改');
  config ??= doc.createNode({});
  config.set('enabled', true); config.set('qqProfileDir', directory); config.set('petId', petId);
  entry.set('config', config);
  if (!rows.length) doc.contents.add(entry);
  const next = doc.toString();
  const backup = path + '.before-pet-qq-' + Date.now();
  await writeFile(backup, before, { flag: 'wx', mode: 0o600 });
  if (await readFile(path, 'utf8') !== before) throw new Error('profile 已被其他程序修改，放弃写入');
  const temporary = path + '.pet-qq-tmp';
  await writeFile(temporary, next, { flag: 'wx', mode: 0o600 });
  // 二次检查缩小与宿主设置写入的竞争窗口。配置时应暂停其他设置操作。
  if (await readFile(path, 'utf8') !== before) throw new Error('profile 写入前发生变化，未替换原文件');
  await rename(temporary, path);
  return '桥接配置已写入（凭据不复制），原 profile 已在同目录备份。请重启 DSH。';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await configureProfile(process.argv[2] ?? '', process.argv[3] ?? '')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
