# -*- coding: utf-8 -*-
"""本地 SQLite 数据访问层（单连接 + 锁，线程安全）。"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import threading
import time
from typing import Any

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if os.environ.get("SASZ_DATA_DIR"):
    # Android 宿主指定的数据目录（应用私有存储）
    DATA_DIR = os.environ["SASZ_DATA_DIR"]
elif getattr(sys, "frozen", False):
    # 打包后数据放 %APPDATA%，避免 onefile 解包临时目录丢数据
    DATA_DIR = os.path.join(
        os.environ.get("APPDATA", os.path.expanduser("~")), "ShangAnZhuShou")
else:
    DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "fenbi_app.db")

_lock = threading.RLock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row
_conn.execute("PRAGMA journal_mode=WAL;")
_conn.execute("PRAGMA foreign_keys=ON;")


SCHEMA = """
CREATE TABLE IF NOT EXISTS kv_settings(k TEXT PRIMARY KEY, v TEXT);

CREATE TABLE IF NOT EXISTS practice_sessions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER, finished_at INTEGER,
  kind TEXT, source_id TEXT, source_name TEXT, prefix TEXT, ex_key TEXT,
  total_count INTEGER DEFAULT 0, correct_count INTEGER DEFAULT 0,
  duration_sec INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS question_results(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER, created_at INTEGER, global_id TEXT,
  module_name TEXT, keypoint TEXT, correct INTEGER, source TEXT DEFAULT 'practice'
);

CREATE TABLE IF NOT EXISTS wrong_questions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_id TEXT UNIQUE, question_id TEXT, prefix TEXT,
  module_name TEXT, keypoint TEXT, content_html TEXT, options_json TEXT,
  material_html TEXT, my_answer TEXT, correct_answer TEXT,
  analysis TEXT, source TEXT,
  wrong_count INTEGER DEFAULT 1, mastery INTEGER DEFAULT 20,
  status TEXT DEFAULT 'active',
  created_at INTEGER, last_review_at INTEGER, next_review_at INTEGER,
  starred INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT, body TEXT, tags TEXT, linked_global TEXT,
  created_at INTEGER, updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT, title TEXT, detail TEXT, duration_min INTEGER,
  required INTEGER DEFAULT 0, source TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'todo', created_at INTEGER, finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS checkins(date TEXT PRIMARY KEY, created_at INTEGER);

CREATE TABLE IF NOT EXISTS focus_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT, started_at INTEGER, duration_sec INTEGER, title TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT, content TEXT, ctx_type TEXT, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS share_records(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER, period TEXT, channel TEXT, file_path TEXT
);
"""
with _lock:
    _conn.executescript(SCHEMA)
    _conn.commit()

# 轻量迁移：为老库补充新增列（重复执行安全）
def _add_col_if_missing(table: str, col: str, ddl: str) -> None:
    cols = [r["name"] for r in _conn.execute(f"PRAGMA table_info({table})")]
    if col not in cols:
        _conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")
        _conn.commit()


with _lock:
    _add_col_if_missing("question_results", "source",
                        "source TEXT DEFAULT 'practice'")
    _add_col_if_missing("wrong_questions", "starred",
                        "starred INTEGER DEFAULT 0")


DEFAULTS: dict[str, Any] = {
    "model": {
        "provider": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "api_key": "",
        "model": "deepseek-chat",
        "temperature": 0.3,
    },
    "fenbi_cookie": "",
    "general": {
        "exam_name": "公务员笔试",
        "exam_date": "",
        "daily_target": 60,
        "reminder_time": "19:00",
        "strict_mode": True,
        "nickname": "",
    },
    "privacy": {"anonymous": False, "hide_phone": True, "current_only": False},
}


def get_setting(key: str) -> Any:
    with _lock:
        row = _conn.execute("SELECT v FROM kv_settings WHERE k=?", (key,)).fetchone()
    if row is None:
        return json.loads(json.dumps(DEFAULTS.get(key, {})))
    saved = json.loads(row["v"])
    merged = json.loads(json.dumps(DEFAULTS.get(key, {})))
    if isinstance(merged, dict) and isinstance(saved, dict):
        merged.update(saved)
        return merged
    return saved


def set_setting(key: str, value: Any) -> None:
    with _lock:
        _conn.execute(
            "INSERT INTO kv_settings(k,v) VALUES(?,?) "
            "ON CONFLICT(k) DO UPDATE SET v=excluded.v",
            (key, json.dumps(value, ensure_ascii=False)),
        )
        _conn.commit()


def now_ms() -> int:
    return int(time.time() * 1000)


def today_str() -> str:
    return time.strftime("%Y-%m-%d")


def insert(sql: str, params: tuple = ()) -> int:
    with _lock:
        cur = _conn.execute(sql, params)
        _conn.commit()
        return cur.lastrowid


def query(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    with _lock:
        return _conn.execute(sql, params).fetchall()


def query_one(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    with _lock:
        return _conn.execute(sql, params).fetchone()


def execute(sql: str, params: tuple = ()) -> None:
    with _lock:
        _conn.execute(sql, params)
        _conn.commit()


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [dict(r) for r in rows]


def create_session(kind: str, source_id: str, source_name: str,
                    prefix: str, ex_key: str, total: int) -> int:
    return insert(
        "INSERT INTO practice_sessions(created_at,kind,source_id,source_name,"
        "prefix,ex_key,total_count) VALUES(?,?,?,?,?,?,?)",
        (now_ms(), kind, str(source_id), source_name, prefix, ex_key, total),
    )


def finish_session(session_id: int, correct: int, duration_sec: int) -> None:
    execute(
        "UPDATE practice_sessions SET finished_at=?,correct_count=?,"
        "duration_sec=? WHERE id=?",
        (now_ms(), correct, duration_sec, session_id),
    )


def add_question_result(session_id: int, global_id: str, module_name: str,
                        keypoint: str, correct: bool,
                        source: str = "practice") -> None:
    insert(
        "INSERT INTO question_results(session_id,created_at,global_id,"
        "module_name,keypoint,correct,source) VALUES(?,?,?,?,?,?,?)",
        (session_id, now_ms(), global_id, module_name, keypoint,
         1 if correct else 0, source),
    )


def get_wrong_by_global(global_id: str) -> sqlite3.Row | None:
    return query_one("SELECT * FROM wrong_questions WHERE global_id=?", (global_id,))


def upsert_wrong(item: dict) -> None:
    existing = get_wrong_by_global(item["global_id"])
    t = now_ms()
    if existing:
        execute(
            "UPDATE wrong_questions SET wrong_count=wrong_count+1, mastery=20,"
            "status='active', my_answer=?, correct_answer=?, content_html=?,"
            "options_json=?, material_html=?, analysis=?, source=?,"
            "module_name=?, keypoint=?, last_review_at=NULL, next_review_at=? "
            "WHERE global_id=?",
            (item["my_answer"], item["correct_answer"], item["content_html"],
             json.dumps(item["options"], ensure_ascii=False), item.get("material_html", ""),
             item["analysis"], item.get("source", ""), item.get("module_name", ""),
             item.get("keypoint", ""), t + 3600 * 1000 * 8, item["global_id"]),
        )
    else:
        insert(
            "INSERT INTO wrong_questions(global_id,question_id,prefix,module_name,"
            "keypoint,content_html,options_json,material_html,my_answer,"
            "correct_answer,analysis,source,wrong_count,mastery,status,"
            "created_at,next_review_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,20,"
            "'active',?,?)",
            (item["global_id"], item.get("question_id", ""), item.get("prefix", "xingce"),
             item.get("module_name", ""), item.get("keypoint", ""), item["content_html"],
             json.dumps(item["options"], ensure_ascii=False), item.get("material_html", ""),
             item["my_answer"], item["correct_answer"], item["analysis"],
             item.get("source", ""), 1, t, t + 3600 * 1000 * 8),
        )


def upsert_cloud_wrong(item: dict) -> bool:
    """合并粉笔云端错题。已存在 → 仅刷新内容/归属，保留掌握度与复习安排（返回 False）；
    不存在 → 新增为待复习（返回 True）。云端不提供历史“我的答案”，新增时留空。"""
    existing = get_wrong_by_global(item["global_id"])
    t = now_ms()
    if existing:
        execute(
            "UPDATE wrong_questions SET prefix=?, module_name=?, keypoint=?,"
            "content_html=?, options_json=?, material_html=?, correct_answer=?,"
            "analysis=?, source=COALESCE(NULLIF(?,''),source), question_id=? "
            "WHERE global_id=?",
            (item.get("prefix", "xingce"), item.get("module_name", ""),
             item.get("keypoint", ""), item.get("content_html", ""),
             json.dumps(item.get("options", []), ensure_ascii=False),
             item.get("material_html", ""), item.get("correct_answer", ""),
             item.get("analysis", ""), item.get("source", ""),
             item.get("question_id", ""), item["global_id"]),
        )
        return False
    insert(
        "INSERT INTO wrong_questions(global_id,question_id,prefix,module_name,"
        "keypoint,content_html,options_json,material_html,my_answer,"
        "correct_answer,analysis,source,wrong_count,mastery,status,"
        "created_at,next_review_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,20,"
        "'active',?,?)",
        (item["global_id"], item.get("question_id", ""), item.get("prefix", "xingce"),
         item.get("module_name", ""), item.get("keypoint", ""),
         item.get("content_html", ""),
         json.dumps(item.get("options", []), ensure_ascii=False),
         item.get("material_html", ""), item.get("my_answer", ""),
         item.get("correct_answer", ""), item.get("analysis", ""),
         item.get("source", ""), t, t),
    )
    return True


def db_file() -> str:
    return DB_PATH


def checkpoint_close() -> None:
    with _lock:
        _conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")


def replace_db(src: str) -> None:
    """用指定数据库文件整体替换当前库（导入备份后无需重启进程）。

    合并 WAL 后关闭连接，覆盖文件并重建连接。调用方需保证 src 为本应用
    导出的有效备份。"""
    global _conn
    import shutil
    with _lock:
        _conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        _conn.close()
        shutil.copy(src, DB_PATH)
        for suffix in ("-wal", "-shm"):
            try:
                os.remove(DB_PATH + suffix)
            except OSError:
                pass
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL;")
        _conn.execute("PRAGMA foreign_keys=ON;")
        _conn.executescript(SCHEMA)
        _conn.commit()
