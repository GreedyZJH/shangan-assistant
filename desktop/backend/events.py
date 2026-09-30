# -*- coding: utf-8 -*-
"""Python -> 前端的事件桥（通过 pywebview 窗口注入 JS）。"""
from __future__ import annotations

import json
from typing import Any

_window: Any = None
_sink: Any = None  # 非 pywebview 宿主（Android 本地服务）的事件出口


def set_window(window: Any) -> None:
    global _window
    _window = window


def set_sink(fn: Any) -> None:
    """注册替代出口：emit(event, payload) 将转交 fn(event, payload)。"""
    global _sink
    _sink = fn


def emit(event: str, payload: Any) -> None:
    if _sink is not None:
        try:
            _sink(event, payload)
        except Exception:
            pass
        return
    if _window is None:
        return
    js = "window.__appEvent(%s,%s)" % (
        json.dumps(event),
        json.dumps(payload, ensure_ascii=False),
    )
    try:
        _window.evaluate_js(js)
    except Exception:
        pass  # 窗口关闭或页面尚未就绪时静默
