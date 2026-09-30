# -*- coding: utf-8 -*-
"""AI 模型服务：统一 OpenAI 兼容协议（DeepSeek/OpenAI/智谱/通义/Kimi/自定义）。"""
from __future__ import annotations

import json
import time
from typing import Any, Callable

import httpx

from . import storage


class AIError(RuntimeError):
    pass


def _config(override: dict | None = None) -> dict:
    cfg = storage.get_setting("model")
    if override:
        cfg = {**cfg, **override}
    return cfg


def _headers(cfg: dict) -> dict:
    key = (cfg.get("api_key") or "").strip()
    if not key:
        raise AIError("尚未配置 API Key，请在【设置 → AI 模型】中填写。")
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _endpoint(cfg: dict) -> str:
    base = (cfg.get("base_url") or "").strip().rstrip("/")
    if not base:
        raise AIError("尚未配置 API Base URL。")
    return f"{base}/chat/completions"


def _payload(cfg: dict, messages: list[dict], temperature: float | None = None,
             extra: dict | None = None) -> dict:
    p = {
        "model": cfg.get("model", ""),
        "messages": messages,
        "temperature": float(cfg.get("temperature", 0.3) if temperature is None
                             else temperature),
    }
    if extra:
        p.update(extra)
    return p


def _assert_ok(resp: httpx.Response) -> None:
    if resp.status_code >= 400:
        try:
            data = resp.json()
            msg = (data.get("error") or {}).get("message") or json.dumps(
                data, ensure_ascii=False)[:300]
        except Exception:
            msg = resp.text[:300]
        raise AIError(f"模型接口返回 {resp.status_code}：{msg}")


def test_connection(cfg_override: dict | None = None) -> dict:
    cfg = _config(cfg_override)
    started = time.time()
    with httpx.Client(timeout=30) as http:
        resp = http.post(
            _endpoint(cfg),
            headers=_headers(cfg),
            json=_payload(cfg, [{"role": "user", "content": "ping"}],
                          temperature=0, extra={"max_tokens": 1}),
        )
        _assert_ok(resp)
    return {"ok": True, "latencyMs": int((time.time() - started) * 1000)}


def chat_text(system: str, user: str, temperature: float = 0.3) -> str:
    """一次性返回完整文本（用于任务生成、报告点评等）。"""
    cfg = _config()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    with httpx.Client(timeout=90) as http:
        resp = http.post(_endpoint(cfg), headers=_headers(cfg),
                         json=_payload(cfg, messages, temperature))
        _assert_ok(resp)
        data = resp.json()
    return data["choices"][0]["message"].get("content", "") or ""


def stream_chat(messages: list[dict],
                on_delta: Callable[[str], None],
                on_done: Callable[[str], None] | None = None,
                on_error: Callable[[str], None] | None = None) -> None:
    """流式对话，逐块回调。"""
    cfg = _config()
    collected: list[str] = []
    try:
        with httpx.Client(timeout=httpx.Timeout(connect=20, read=120, write=20,
                                                 pool=20)) as http:
            with http.stream(
                "POST",
                _endpoint(cfg),
                headers=_headers(cfg),
                json=_payload(cfg, messages, extra={"stream": True}),
            ) as resp:
                _assert_ok(resp)
                for line in resp.iter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0].get("delta", {})
                        piece = delta.get("content") or ""
                    except Exception:
                        continue
                    if piece:
                        collected.append(piece)
                        on_delta(piece)
        full = "".join(collected)
        if on_done:
            on_done(full)
    except Exception as exc:
        if on_error:
            on_error(str(exc))
        else:
            raise
