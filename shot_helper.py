# -*- coding: utf-8 -*-
"""一次性脚本：启动应用并自动截取各功能页面截图（用于用户手册）。用完即删。"""
import ctypes
import ctypes.wintypes as wt
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "desktop"))

try:  # 让截图坐标与物理像素一致
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()

import webview  # noqa: E402
from PIL import ImageGrab  # noqa: E402

from backend import api, events  # noqa: E402  (scheduler 不启动，避免弹提醒)

OUT = os.path.join(HERE, "docs", "shots")
os.makedirs(OUT, exist_ok=True)

TITLE = "上岸助手 · 考公刷题 [截图]"
DWMWA_EXTENDED_FRAME_BOUNDS = 9


def _win_rect():
    """按窗口标题取精确客户区外框（含 DPI 修正，去掉 Win11 阴影边）。"""
    hwnd = ctypes.windll.user32.FindWindowW(None, TITLE)
    if not hwnd:
        raise RuntimeError("找不到主窗口")
    rect = wt.RECT()
    res = ctypes.windll.dwmapi.DwmGetWindowAttribute(
        hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(rect), ctypes.sizeof(rect))
    if res != 0:
        ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))
    return hwnd, (rect.left, rect.top, rect.right, rect.bottom)


HWND_TOPMOST = -1
HWND_NOTOPMOST = -2
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001


def run(window):
    time.sleep(4)  # 等首页与数据加载
    hwnd, _ = _win_rect()
    # 移到左上角并压缩高度，避免窗口底部超出屏幕把任务栏截进图里
    window.move(2, 2)
    window.resize(1280, 790)
    time.sleep(0.5)
    # 强制置顶，避免前台其他窗口（如聊天工具）遮挡截图
    ctypes.windll.user32.SetWindowPos(
        hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
    time.sleep(0.8)
    # 关闭可能的「连接粉笔账号」遮罩，避免遮挡界面
    window.evaluate_js(
        "var m=document.getElementById('connectMask'); if(m) m.style.display='none';")
    time.sleep(0.6)

    pages = [("practice", "01_刷题"), ("wrong", "02_错题本"), ("notes", "03_笔记"),
             ("report", "04_学习报告"), ("settings", "05_设置")]
    try:
        for sid, name in pages:
            if sid != "practice":
                window.evaluate_js(
                    f"var b=document.querySelector('.rail [data-s=\"{sid}\"]');"
                    "if(b) b.click();")
            time.sleep(2.8)  # 等 async 渲染与数据加载完成
            img = ImageGrab.grab(bbox=_win_rect()[1], all_screens=False)
            path = os.path.join(OUT, f"{name}.png")
            img.save(path)
            print("saved", path, img.size)
    finally:
        ctypes.windll.user32.SetWindowPos(
            hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
    window.destroy()


def _make_wrapper(func):
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    return staticmethod(wrapper)


def build_api_class():
    import inspect
    members = {}
    for name, fn in inspect.getmembers(api, inspect.isfunction):
        if name.startswith("_"):
            continue
        members[name] = _make_wrapper(fn)
    return type("Api", (), members)


def main():
    page = os.path.join(HERE, "desktop", "web", "index.html")
    window = webview.create_window(
        TITLE, page, js_api=build_api_class()(),
        width=1280, height=860, min_size=(1024, 700),
        background_color="#f5f7fb")
    events.set_window(window)
    webview.start(run, window)


if __name__ == "__main__":
    main()
