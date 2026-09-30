# -*- coding: utf-8 -*-
"""督学：到点检查今日任务，未完成则弹出提醒（应用运行期间生效）。"""
from __future__ import annotations

import threading
import time
from datetime import date

from . import events, storage


def _hhmm_now() -> str:
    return time.strftime("%H:%M")


def _undone_required_today() -> int:
    row = storage.query_one(
        "SELECT COUNT(*) c FROM tasks WHERE date=? AND status<>'done' AND required=1",
        (storage.today_str(),),
    )
    return row["c"]


def _questions_today() -> int:
    start = int(time.mktime(date.today().timetuple()) * 1000)
    row = storage.query_one(
        "SELECT COUNT(*) c FROM question_results WHERE created_at>=?", (start,)
    )
    return row["c"]


class Scheduler(threading.Thread):
    daemon = True

    def __init__(self) -> None:
        super().__init__(name="scheduler")
        self._notified_date = ""

    def run(self) -> None:
        while True:
            time.sleep(20)
            try:
                self._tick()
            except Exception:
                pass

    def _tick(self) -> None:
        general = storage.get_setting("general")
        today = storage.today_str()
        if self._notified_date != today and _hhmm_now() >= general.get(
                "reminder_time", "19:00"):
            pending_tasks = _undone_required_today()
            target = int(general.get("daily_target", 0) or 0)
            done_q = _questions_today()
            if pending_tasks or (target and done_q < target):
                self._notified_date = today
                events.emit("toast", {
                    "kind": "reminder",
                    "title": "小岸提醒：今天的任务还没完成",
                    "text": (f'还有 {pending_tasks} 项必做任务未完成，'
                             f'今日刷题 {done_q}/{target}。' +
                             ("严格模式：完成后再来找我打卡"
                              if general.get("strict_mode") else "注意劳逸结合。")),
                })
        if self._notified_date and self._notified_date != today:
            self._notified_date = ""


def start() -> None:
    Scheduler().start()
