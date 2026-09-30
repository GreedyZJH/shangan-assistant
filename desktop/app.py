# -*- coding: utf-8 -*-
"""上岸助手 · 桌面端入口。
启动：py -3.12 desktop/app.py
"""
from __future__ import annotations

import inspect
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

if getattr(sys, "frozen", False):
    # PyInstaller 打包：资源在解包目录，用户数据放 %APPDATA%（exe 目录可能无写权限）
    RES_DIR = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    DATA_DIR = os.path.join(
        os.environ.get("APPDATA", os.path.expanduser("~")), "ShangAnZhuShou")
else:
    RES_DIR = HERE
    DATA_DIR = os.path.join(HERE, "backend", "data")

if HERE not in sys.path:
    sys.path.insert(0, HERE)

DB_FILE = os.path.join(DATA_DIR, "fenbi_app.db")
PENDING = os.path.join(DATA_DIR, "pending_restore.db")
os.makedirs(DATA_DIR, exist_ok=True)


def apply_pending_restore() -> None:
    """若存在待恢复备份，必须在导入 backend（其模块级即建立 SQLite 连接）之前替换数据库。"""
    if not os.path.exists(PENDING):
        return
    for suffix in ("", "-wal", "-shm"):
        target = DB_FILE + suffix
        if os.path.exists(target):
            try:
                os.remove(target)
            except OSError:
                pass
    shutil.move(PENDING, DB_FILE)


apply_pending_restore()

import webview  # noqa: E402

from backend import api, events, scheduler  # noqa: E402


def _make_wrapper(func):
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)

    # 必须用 staticmethod：动态挂载到类上的普通函数会变成绑定方法，
    # pywebview 调用时会把实例作为 self 透传，导致无参函数收到多余参数。
    return staticmethod(wrapper)


def build_api_class():
    members = {}
    for name, fn in inspect.getmembers(api, inspect.isfunction):
        if name.startswith("_"):
            continue
        members[name] = _make_wrapper(fn)
    return type("Api", (), members)


def main():
    page = os.path.join(RES_DIR, "web", "index.html")
    window = webview.create_window(
        "上岸助手 · 考公刷题",
        page,
        js_api=build_api_class()(),
        width=1280,
        height=860,
        min_size=(1024, 700),
        background_color="#f5f7fb",
    )
    events.set_window(window)
    scheduler.start()
    webview.start()


if __name__ == "__main__":
    main()
