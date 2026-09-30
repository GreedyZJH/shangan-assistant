/* 安卓版 AI 模型服务（翻译 ai_svc.py）。
 * 统一 OpenAI 兼容协议（DeepSeek/OpenAI/智谱/通义/Kimi/自定义）。
 * 网络走 CapacitorHttp 原生层；流式对话降级为一次性整段返回。 */
(function () {
  'use strict';

  class AIError extends Error {
    constructor(msg) { super(msg); this.name = 'AIError'; }
  }

  const CapHttp = () => window.Capacitor.Plugins.CapacitorHttp;

  function config(override) {
    const cfg = DB.getSetting('model') || {};
    return override ? Object.assign({}, cfg, override) : cfg;
  }

  function headers(cfg) {
    const key = (cfg.api_key || '').trim();
    if (!key) throw new AIError('尚未配置 API Key，请在【设置 → AI 模型】中填写。');
    return { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
  }

  function endpoint(cfg) {
    const base = (cfg.base_url || '').trim().replace(/\/+$/, '');
    if (!base) throw new AIError('尚未配置 API Base URL。');
    return base + '/chat/completions';
  }

  function payload(cfg, messages, temperature, extra) {
    const p = {
      model: cfg.model || '',
      messages: messages,
      temperature: temperature == null
        ? Number(cfg.temperature == null ? 0.3 : cfg.temperature)
        : temperature,
    };
    if (extra) Object.assign(p, extra);
    return p;
  }

  async function post(cfg, body, timeoutMs) {
    let resp;
    try {
      resp = await CapHttp().request({
        url: endpoint(cfg),
        method: 'POST',
        headers: headers(cfg),
        data: body,
        readTimeout: timeoutMs || 90000,
        connectTimeout: 20000,
      });
    } catch (e) {
      throw new AIError('无法连接模型接口：' + (e && e.message ? e.message : e));
    }
    if (resp.status >= 400) {
      let msg = '';
      try {
        const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
        msg = (data && data.error && data.error.message)
          || JSON.stringify(data).slice(0, 300);
      } catch (e2) {
        msg = String(resp.data || '').slice(0, 300);
      }
      throw new AIError('模型接口返回 ' + resp.status + '：' + msg);
    }
    return typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
  }

  async function testConnection(cfgOverride) {
    const cfg = config(cfgOverride);
    const t0 = Date.now();
    await post(cfg, payload(cfg, [{ role: 'user', content: 'ping' }], 0, { max_tokens: 1 }), 30000);
    return { ok: true, latencyMs: Date.now() - t0 };
  }

  /* 一次性返回完整文本（用于任务生成、报告点评等）。 */
  async function chatText(system, user, temperature) {
    const cfg = config();
    const data = await post(cfg, payload(cfg, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], temperature == null ? 0.3 : temperature));
    const ch = (data.choices && data.choices[0]) || {};
    return (ch.message && ch.message.content) || '';
  }

  /* 流式对话降级：一次性请求完成，先整体回调 on_delta，再 on_done。 */
  async function streamChat(messages, onDelta, onDone, onError) {
    try {
      const cfg = config();
      const data = await post(cfg, payload(cfg, messages), 120000);
      const full = (((data.choices || [])[0] || {}).message || {}).content || '';
      if (onDelta && full) onDelta(full);
      if (onDone) onDone(full);
    } catch (exc) {
      if (onError) onError(String(exc && exc.message ? exc.message : exc));
      else throw exc;
    }
  }

  window.AI = {
    AIError: AIError,
    testConnection: testConnection,
    chatText: chatText,
    streamChat: streamChat,
  };
})();
