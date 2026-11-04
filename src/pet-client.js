export class PetError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// 限定回环地址；不能通过配置把宠物对话转发到任意远端或重定向目的地。
export function localOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new PetError('invalid-local-origin');
  }
  return url.origin;
}

export class PetClient {
  constructor({ origin, petId, surface = 'any', timeoutMs = 120000, fetchImpl = fetch }) {
    this.origin = origin; this.petId = petId; this.surface = surface;
    this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }
  async request(method, text) {
    const origin = localOrigin(typeof this.origin === 'function' ? this.origin() : this.origin);
    const url = new URL('/dsh-pet-7340/chat', origin);
    url.searchParams.set('pet', this.petId);
    // 状态检查只取 0 轮，不拉取任何聊天内容。
    if (method === 'GET') url.searchParams.set('rounds', '0');
    else url.searchParams.set('surface', this.surface);
    let response;
    try {
      response = await this.fetch(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) } : {}),
      });
    } catch (error) {
      throw new PetError(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'connection-failed');
    }
    if (!response.ok) throw new PetError(`http-${response.status}`);
    let data;
    try { data = await response.json(); } catch { throw new PetError('invalid-response'); }
    if (!data || data.ok !== true) {
      // 不向 QQ 暴露上游 message（可能包含路径、密钥、模型请求内容）。
      const allowed = ['provider-missing', 'unknown-pet', 'pet-not-displayed', 'generate-error', 'bad-request'];
      throw new PetError(allowed.includes(data?.reason) ? data.reason : 'pet-error');
    }
    if (method === 'POST' && (typeof data.text !== 'string' || !data.text.trim())) throw new PetError('invalid-response');
    return data;
  }
  async chat(text) { return (await this.request('POST', text)).text; }
  async check() { await this.request('GET'); }
}
