import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const HOOK_KEY = 'dsh-pet-qq-bridge.memory.v1';
const MARKER = '/* dsh-pet-qq-bridge layered-memory v1 */';
const BEFORE = '\t\tconst generated = await generateChat(ctx, system, list, text, pool, configuredModel(found.conf, "chatModel"));';
const AFTER = '\t\tawait writeMemory(mem);\n\t\tstate.writePet(petId, "say", generated.image ? {';
const BEFORE_NEW = `${MARKER}
\t\tconst petMemory = globalThis[Symbol.for("${HOOK_KEY}")]?.get(petId);
\t\tconst preparedMemory = petMemory ? await petMemory.prepare({ text, history: list, messages: entry.messages }) : null;
\t\tconst generated = preparedMemory?.reply !== undefined
\t\t\t? { ok: true, text: preparedMemory.reply }
\t\t\t: await generateChat(ctx, system + (preparedMemory?.context ?? ""), preparedMemory?.history ?? list, text, pool, configuredModel(found.conf, "chatModel"));`;
const AFTER_NEW = `\t\tawait writeMemory(mem);
\t\tif (petMemory) {
\t\t\ttry { await petMemory.sync(entry.messages); }
\t\t\tcatch { console.error("[pet-memory] 分层记忆同步失败，下次对话将重新同步原始记录。"); }
\t\t}
\t\tstate.writePet(petId, "say", generated.image ? {`;
const hash = value => createHash('sha256').update(value).digest('hex');

export function patchSource(source, version) {
  if (version !== '0.3.8') throw new Error('目前仅支持 dsh-pet 0.3.8；其他版本需要重新验证');
  if (source.includes(MARKER)) {
    if (!source.includes(BEFORE_NEW) || !source.includes(AFTER_NEW)) throw new Error('检测到不完整补丁，拒绝继续');
    return source;
  }
  for (const anchor of [BEFORE, AFTER]) if (source.split(anchor).length !== 2) throw new Error('桌宠构建产物与已测版本不匹配，未修改文件');
  return source.replace(BEFORE, BEFORE_NEW).replace(AFTER, AFTER_NEW);
}

export async function patchPet(directory, restore = false) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (manifest.name !== 'dsh-pet') throw new Error('目标不是 dsh-pet 包目录');
  const target = join(directory, 'lib', 'index.js');
  const backup = target + '.qq-memory-backup';
  const receipt = backup + '.json';
  const current = await readFile(target, 'utf8');
  if (restore) {
    const info = JSON.parse(await readFile(receipt, 'utf8'));
    const original = await readFile(backup, 'utf8');
    if (hash(current) !== info.patched || hash(original) !== info.original) throw new Error('文件已被更新或修改，拒绝用旧备份覆盖');
    const tmp = target + '.qq-memory-tmp'; await writeFile(tmp, original, { mode: (await stat(target)).mode }); await rename(tmp, target);
    return '已恢复原桌宠代码，请重启 DSH';
  }
  const patched = patchSource(current, manifest.version);
  if (patched === current) return '兼容补丁已存在';
  // 原文件和补丁的摘要记录在包目录内；不会触碰用户聊天、配置或素材。
  try { await writeFile(backup, current, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST' || hash(await readFile(backup, 'utf8')) !== hash(current)) throw new Error('已有不同备份，停止安装补丁'); }
  await writeFile(receipt, JSON.stringify({ original: hash(current), patched: hash(patched), version: manifest.version }), { mode: 0o600 });
  const tmp = target + '.qq-memory-tmp'; await writeFile(tmp, patched, { mode: (await stat(target)).mode }); await rename(tmp, target);
  return '兼容补丁已安装，请重启 DSH';
}

export async function hasPatch(directory) {
  const source = await readFile(join(directory, 'lib', 'index.js'), 'utf8');
  return source.includes(BEFORE_NEW) && source.includes(AFTER_NEW);
}
