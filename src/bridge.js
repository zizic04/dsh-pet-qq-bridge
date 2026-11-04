const HELP = '这里连接的是你的桌宠，QQ 和桌面共用人设与分层记忆。\n/pet-status 检查桌宠连接\n/记忆 查看分层记忆\n/记住 键=值 保存或纠正长期事实\n/人设 键=值 保存稳定人格/关系\n/忘记 键或关键词 停止召回相关记忆\n当前仅支持文字，不执行 DSH Agent 任务。';
const ERRORS = {
  'unknown-pet': '找不到指定桌宠，请检查 petId。',
  'pet-not-displayed': '桌宠当前被隐藏，或显示端不匹配，请先在 DSH 中显示它。',
  'provider-missing': '桌宠尚未配置可用模型，请先在电脑上和它聊一句。',
  'timeout': '等待桌宠回复超时；它可能仍在处理并保存记忆。请先到桌面查看，不要立即重复发送。',
  'connection-failed': '无法连接本机桌宠，请检查 DSH 是否运行及本地地址是否正确。',
};

export class Bridge {
  constructor({ ownerOpenId, pet, send, maxQueue = 3, now = Date.now, logger = console }) {
    if (typeof ownerOpenId !== 'string' || !ownerOpenId.trim()) throw new Error('ownerOpenId 必填');
    this.owner = ownerOpenId; this.pet = pet; this.send = send; this.maxQueue = maxQueue;
    this.now = now; this.logger = logger; this.pending = 0; this.tail = Promise.resolve();
    this.seen = new Map(); this.closed = false;
  }
  async handle(message) {
    // 所有路径（包括状态命令）先校验发送者。群、频道、其他用户一律不触达桌宠。
    if (this.closed || message.kind !== 'c2c' || message.senderId !== this.owner || message.senderIsBot) return;
    if (typeof message.messageId !== 'string' || !message.messageId) return;
    const target = { scope: 'c2c', targetId: this.owner, msgId: message.messageId };
    const time = this.now();
    for (const [key, expires] of this.seen) if (expires <= time) this.seen.delete(key);
    if (this.seen.has(message.messageId)) return;
    // 有界缓存。满时拒绝新消息，不挤掉仍在去重窗口里的记录。
    if (this.seen.size >= 1000) return;
    this.seen.set(message.messageId, time + 10 * 60_000);
    const text = typeof message.content === 'string' ? message.content.trim() : '';
    if (message.attachments?.length) return this.reply(target, '当前桥接仅支持纯文字，图片、语音和文件不会写入桌宠记忆。');
    if (!text) return;
    if (text === '/pet-help' || text === '/help') return this.reply(target, HELP);
    if (text === '/pet-status' || text === '/bot-ping') {
      try { await this.pet.check(); return this.reply(target, '桌宠接口正常。QQ 正在使用同一只桌宠的人设和记忆。'); }
      catch (error) { return this.reply(target, this.errorText(error)); }
    }
    if (text.startsWith('/') && !/^\/(记忆|记住|忘记|人设|memory)(?:\s|$)/u.test(text)) return this.reply(target, '桥接模式不执行或清空 Agent 会话。发送 /pet-help 查看支持的命令。');
    if (text.length > 2000) return this.reply(target, '消息超过桌宠接口的 2000 字符限制，请缩短后发送。');
    if (this.pending >= this.maxQueue) return this.reply(target, '桌宠的消息队列已满。这条消息尚未写入记忆，请稍后重新发送。');
    this.pending++;
    const job = this.tail.then(async () => {
      if (this.closed) return;
      if (this.now() - time > 60_000) return this.reply(target, '这条消息等待超过一分钟，尚未送给桌宠，请稍后重新发送。');
      let answer;
      try { answer = await this.pet.chat(text); }
      catch (error) { return this.reply(target, this.errorText(error)); }
      // 一条被动回复，避免超出 QQ 回包数量限制；完整结果仍保存在桌宠记忆里。
      const chars = Array.from(answer);
      const reply = chars.length > 3500 ? chars.slice(0, 3400).join('') + '\n\n（回复较长，完整内容请在桌宠聊天窗口查看。）' : answer;
      await this.reply(target, reply);
    }).finally(() => { this.pending--; });
    this.tail = job.catch(() => {});
    return job;
  }
  errorText(error) { return ERRORS[error?.code] ?? '桌宠暂时无法回复，请在电脑上检查插件和模型。为避免重复写入记忆，本桥接不会自动重试。'; }
  async reply(target, text) {
    if (this.closed) return;
    try { await this.send(target, text); }
    catch { this.logger.warn('QQ 回复发送失败；不会重新调用桌宠。请在桌面查看该轮记录。'); }
  }
  async close() { this.closed = true; await this.tail; }
}
