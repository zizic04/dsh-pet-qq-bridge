import { readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { parseDocument } from 'yaml';

const literal = value => typeof value === 'string' && value.trim() && value !== '__FROM_ENV__' ? value.trim() : '';

// 只读取明确指定的 profile，不猜测账号、不修改官方插件配置、不执行 !!js。
export function readBindingYaml(text) {
  const doc = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: () => null }] });
  if (doc.errors.length) throw new Error('QQ profile YAML 无法解析');
  const rows = doc.toJS({ maxAliasCount: 50 });
  if (!Array.isArray(rows)) throw new Error('QQ profile 顶层必须是数组');
  const found = rows.filter(row => row?.id === 'im-qqbot');
  if (found.length !== 1) throw new Error('QQ profile 必须恰有一个 im-qqbot 配置条目');
  const config = found[0].config;
  if (!config || typeof config !== 'object') throw new Error('QQ 绑定配置缺失');
  const allow = config.access?.c2cAllow;
  const ownerOpenId = config.access?.c2cMode === 'allowlist' && Array.isArray(allow) && allow.length === 1
    ? literal(allow[0]) : '';
  return { appId: literal(config.appId), appSecret: literal(config.appSecret), ownerOpenId };
}

export async function resolveConfig(input = {}, env = process.env) {
  let saved = {};
  if (input.qqProfileDir) {
    if (!isAbsolute(input.qqProfileDir)) throw new Error('qqProfileDir 必须是绝对路径');
    saved = readBindingYaml(await readFile(join(input.qqProfileDir, 'cordis.patch.yml'), 'utf8'));
  }
  const config = {
    appId: literal(input.appId) || literal(env.QQBOT_APPID) || saved.appId,
    appSecret: literal(input.appSecret) || literal(env.QQBOT_SECRET) || saved.appSecret,
    ownerOpenId: literal(input.ownerOpenId) || literal(env.QQ_PET_OWNER_OPENID) || saved.ownerOpenId,
    petId: literal(input.petId),
    petBaseUrl: input.petBaseUrl || '',
    surface: input.surface ?? 'any',
    timeoutMs: input.timeoutMs ?? 120000,
    maxQueue: input.maxQueue ?? 3,
  };
  for (const key of ['appId', 'appSecret', 'ownerOpenId', 'petId']) {
    if (!config[key]) throw new Error(`缺少 ${key}；不会开放给所有人或自动绑定首位发送者`);
  }
  if (!['any', 'web', 'desktop', 'both'].includes(config.surface)) throw new Error('surface 无效');
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 180000) throw new Error('timeoutMs 须为 1000–180000');
  if (!Number.isInteger(config.maxQueue) || config.maxQueue < 1 || config.maxQueue > 10) throw new Error('maxQueue 须为 1–10');
  return config;
}
