# -*- coding: utf-8 -*-
"""暴露给前端 JS 的 API 桥（window.pywebview.api.*）。"""
from __future__ import annotations

import base64
import calendar
import html as html_mod
import io
import json
import os
import re
import shutil
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta

try:
    import webview
    HAS_WEBVIEW = True
except ImportError:  # Android 等非 pywebview 宿主
    webview = None
    HAS_WEBVIEW = False

from . import ai_svc, events, fenbi_svc, reports, storage


def _err(msg: str) -> dict:
    return {"__error__": str(msg)}


def text_to_html(text: str) -> str:
    return re.sub(" {2,}", '<span class="q-blank"></span>',
                  _esc(text)).replace("\n", "<br>")


def _esc(s) -> str:
    return html_mod.escape(str(s if s is not None else ""), quote=False)


def _ms_to_date_label(ms: int | None) -> str:
    if not ms:
        return ""
    d = datetime.fromtimestamp(ms / 1000).date()
    today = date.today()
    if d == today:
        return "今天复习"
    if d == today + timedelta(days=1):
        return "明天复习"
    return f"{d.month}月{d.day}日复习"


# ================================================================== 初始化 ==
def app_init() -> dict:
    model = storage.get_setting("model")
    general = storage.get_setting("general")
    privacy = storage.get_setting("privacy")
    cookie_set = bool(storage.get_setting("fenbi_cookie").strip())
    wrong_active = storage.query_one(
        "SELECT COUNT(*) c FROM wrong_questions WHERE status='active'")["c"]
    notes_n = storage.query_one("SELECT COUNT(*) c FROM notes")["c"]
    today_tasks = storage.query_one(
        "SELECT COUNT(*) c FROM tasks WHERE date=? AND status='done'",
        (storage.today_str(),),
    )["c"]
    day_start = int(time.mktime(date.today().timetuple()) * 1000)
    today_questions = storage.query_one(
        "SELECT COUNT(*) c FROM question_results WHERE created_at>=?",
        (day_start,),
    )["c"]
    return {
        "model": {**model, "api_key_set": bool(model.get("api_key"))},
        "general": general,
        "privacy": privacy,
        "cookieSet": cookie_set,
        "counts": {"wrongActive": wrong_active, "notes": notes_n,
                   "todayTasksDone": today_tasks,
                   "todayQuestions": today_questions,
                   "streak": reports._streak()},
    }


# ================================================================== 粉笔 ====
def fenbi_whoami() -> dict:
    return fenbi_svc.whoami()


def fenbi_keypoints(refresh: bool = False) -> list[dict]:
    return fenbi_svc.keypoint_tree("xingce", refresh)


def fenbi_labels() -> list[dict]:
    return fenbi_svc.list_labels("xingce")


def fenbi_papers(label_id: int, page: int = 0, page_size: int = 20,
                 keyword: str = "") -> dict:
    return fenbi_svc.list_papers("xingce", int(label_id), int(page),
                                 int(page_size), keyword)


# ================================================================== 练习 ====
def practice_start_keypoint(keypoint_id: int, limit: int) -> dict:
    data = fenbi_svc.start_keypoint("xingce", int(keypoint_id), int(limit))
    tree = fenbi_svc.keypoint_tree("xingce")
    module = fenbi_svc.find_module_of_keypoint(tree, int(keypoint_id))
    sid = storage.create_session(
        "keypoint", keypoint_id, data["name"], "xingce",
        data["key"], len(data["questions"]))
    return {**data, "sessionId": sid, "module": module}


def practice_start_paper(paper_id: int) -> dict:
    data = fenbi_svc.start_paper("xingce", int(paper_id))
    sid = storage.create_session(
        "paper", paper_id, data["name"], "xingce",
        data["key"], len(data["questions"]))
    return {**data, "sessionId": sid, "module": ""}


def practice_similar(payload: dict | None = None) -> dict:
    """按考点从粉笔题库出同类题（payload:
    {keypointId?, keypointName?, moduleName?, excludeGid?, limit?}）。"""
    payload = payload or {}
    limit = max(1, min(10, int(payload.get("limit") or 2)))
    raw_id = payload.get("keypointId")
    data = fenbi_svc.start_similar(
        prefix="xingce",
        keypoint_id=int(raw_id) if raw_id not in (None, "") else None,
        keypoint_name=payload.get("keypointName", "") or "",
        module_name=payload.get("moduleName", "") or "",
        exclude_gid=str(payload.get("excludeGid", "") or ""),
        limit=limit,
    )
    sid = storage.create_session(
        "similar", data["sourceId"], data["name"], "xingce",
        data["key"], len(data["questions"]))
    tree = fenbi_svc.keypoint_tree("xingce")
    module = fenbi_svc.find_module_of_keypoint(tree, int(data["sourceId"]))
    return {**data, "sessionId": sid, "module": module}


def _map_names_to_modules(tree: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}

    def walk(nodes: list[dict], module: str) -> None:
        for n in nodes:
            mod = module or n.get("name", "")
            out[n.get("name", "")] = mod
            walk(n.get("children") or [], mod)

    walk(tree, "")
    return out


def practice_submit(payload: dict) -> dict:
    session_id = int(payload["sessionId"])
    key = payload["key"]
    prefix = payload.get("prefix", "xingce")
    answers = payload.get("answers", [])
    duration_sec = int(payload.get("durationSec", 0))
    module_given = payload.get("module", "")

    result = fenbi_svc.submit(key, prefix, answers)

    name_map: dict[str, str] = {}
    try:
        name_map = _map_names_to_modules(fenbi_svc.keypoint_tree(prefix))
    except Exception:
        pass

    for item in result["items"]:
        kp = item["keypoints"][0] if item["keypoints"] else ""
        mod = module_given or name_map.get(kp, "") or "未分类"
        storage.add_question_result(
            session_id, item["globalId"], mod, kp, item["correct"])
        # 本地累计作答统计（含本场），供解析区展示"个人正确率"
        row = storage.query_one(
            "SELECT COUNT(*) n, COALESCE(SUM(correct),0) c"
            " FROM question_results WHERE global_id=?",
            (item["globalId"],))
        item["localAttempts"] = row["n"] if row else 0
        item["localCorrect"] = row["c"] if row else 0
        if not item["correct"]:
            storage.upsert_wrong({
                "global_id": item["globalId"],
                "question_id": "",
                "prefix": prefix,
                "module_name": mod,
                "keypoint": kp,
                "content_html": text_to_html(item["question"]),
                "options": item["options"],
                "my_answer": item["myAnswer"],
                "correct_answer": item["correctAnswer"],
                "analysis": item["analysis"],
                "source": item.get("source", ""),
            })

    storage.finish_session(session_id, result["correctCount"], duration_sec)
    # 完成练习即视为打卡
    storage.insert(
        "INSERT OR IGNORE INTO checkins(date,created_at) VALUES(?,?)",
        (storage.today_str(), storage.now_ms()),
    )
    return result


# ============================================================ 练习历史 ======
def practice_history(limit: int = 100) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    rows = storage.query(
        "SELECT id, kind, source_name, total_count, correct_count,"
        " duration_sec, finished_at FROM practice_sessions"
        " WHERE finished_at IS NOT NULL"
        " ORDER BY finished_at DESC LIMIT ?",
        (limit,))
    return storage.rows_to_dicts(rows)


def practice_history_detail(session_id: int) -> dict:
    """回看一场已完成的练习：本地作答记录 + 粉笔原题/解析 + 难度。"""
    sess = storage.query_one(
        "SELECT * FROM practice_sessions WHERE id=?", (int(session_id),))
    if not sess:
        raise RuntimeError("练习记录不存在。")
    prefix = sess["prefix"] or "xingce"

    # 1) 本场每题的对错（按首次出现顺序）
    items: list[dict] = []
    correct_map: dict[str, int] = {}
    for r in storage.query(
            "SELECT global_id, correct FROM question_results"
            " WHERE session_id=? ORDER BY id", (sess["id"],)):
        gid = str(r["global_id"])
        if gid in correct_map:
            continue
        correct_map[gid] = int(r["correct"] or 0)
        items.append({"globalId": gid})
    if not items:
        raise RuntimeError("本地作答明细缺失，无法回看这场练习。")

    # 2) 远端内容：原卷题面 / 解析 / 难度（拿不到时降级展示本地部分）
    qmap: dict[str, dict] = {}
    brief: dict[str, dict] = {}
    sol_by_key: dict[str, dict] = {}
    mat_map: dict[str, str] = {}
    sols: list[dict] = []
    try:
        client = fenbi_svc.get_client()
        if sess["ex_key"]:
            # 主路径：交卷解析包（getSolution 交卷后仍可访问）
            try:
                pack = client.get_solutions(sess["ex_key"], prefix)
                for m in pack.get("materials", []) or []:
                    if m.get("globalId"):
                        mat_map[str(m["globalId"])] = m.get("content") or ""
                sols = pack.get("solutions", []) or []
                for s in sols:
                    for k in (s.get("globalId"), s.get("id")):
                        if k is not None:
                            sol_by_key[str(k)] = s
            except Exception:
                sols = []
            # 补充：原卷内容（getExercise，可能过期）——材料归属、题面
            try:
                meta = client._get_exercise_meta(sess["ex_key"], prefix)
                content = client._get_content_by_meta(meta, prefix)
                for q in content.get("questions") or []:
                    if q.get("globalId"):
                        qmap[str(q["globalId"])] = q
            except Exception:
                qmap = {}
            # 难度：数字题 id 来自解析包与原卷，能取多少算多少
            ids = ([s.get("id") for s in sols if s.get("id")]
                   + [q.get("id") for q in qmap.values() if q.get("id")])
            if ids:
                try:
                    brief = client.get_questions_brief(prefix, ids)
                except Exception:
                    brief = {}
    except Exception:
        pass  # Cookie 过期 / 原卷过期：降级为仅展示本地记录

    out_items: list[dict] = []
    for it in items:
        gid = it["globalId"]
        q = qmap.get(gid, {})
        s = sol_by_key.get(gid) or {}
        b = brief.get(str(s.get("id"))) or brief.get(str(q.get("id"))) or {}
        mat_id = q.get("materialGlobalId") or q.get("materialId")
        base = {
            "globalId": gid,
            "myAnswer": "",
            "correct": bool(correct_map.get(gid, 0)),
            "hist": True,
            "difficulty": b.get("difficulty"),
            "material": mat_map.get(str(mat_id), "") if mat_id else "",
        }
        # 本地累计作答统计
        try:
            row = storage.query_one(
                "SELECT COUNT(*) n, COALESCE(SUM(correct),0) c"
                " FROM question_results WHERE global_id=?", (gid,))
            base["localAttempts"] = row["n"] if row else 0
            base["localCorrect"] = row["c"] if row else 0
        except Exception:
            base["localAttempts"] = 0
            base["localCorrect"] = 0

        if s:
            out_items.append({
                **base,
                "question": s.get("question", ""),
                "options": s.get("options", []),
                "correctAnswer": s.get("correctAnswer", ""),
                "correctAnswerText": s.get("correctAnswerText", ""),
                "analysis": s.get("analysis", ""),
                "source": s.get("source") or "",
                "keypoints": s.get("keypoints") or [],
            })
        elif q or b:
            src = q or b
            opts: list[str] = []
            letter = ""
            try:
                opts = fenbi_svc.fc._extract_options(src.get("accessories"))
                letter = fenbi_svc.fc._index_to_letter(
                    (src.get("correctAnswer") or {}).get("choice"))
            except Exception:
                pass
            out_items.append({
                **base,
                "question": fenbi_svc.fc._rich_to_text(src.get("content"))
                            or "（原练习内容已过期，无法回看本题）",
                "options": opts,
                "correctAnswer": letter,
                "correctAnswerText": "",
                "analysis": "（该题解析内容受限，暂无法回看）",
                "source": src.get("shortSource") or "",
                "keypoints": [],
            })
        else:
            out_items.append({
                **base,
                "question": "（原练习内容已过期，无法回看本题）",
                "options": [],
                "correctAnswer": "",
                "correctAnswerText": "",
                "analysis": "",
                "source": "",
                "keypoints": [],
            })

    return {
        "hist": True,
        "sessionId": sess["id"],
        "name": sess["source_name"] or "练习记录",
        "kind": sess["kind"] or "keypoint",
        "finishedAt": sess["finished_at"],
        "durationSec": sess["duration_sec"] or 0,
        "items": out_items,
        "total": len(out_items),
        "correctCount": sum(1 for x in out_items if x["correct"]),
    }


# ================================================================== 错题 ====
def wrong_list(query: str = "", status: str = "active", module: str = "") -> list[dict]:
    sql = "SELECT * FROM wrong_questions WHERE status=?"
    params: list = [status]
    if module:
        sql += " AND module_name=?"
        params.append(module)
    if query:
        sql += " AND (content_html LIKE ? OR keypoint LIKE ?)"
        params += [f"%{query}%", f"%{query}%"]
    sql += " ORDER BY COALESCE(next_review_at,0) ASC, id ASC"
    rows = storage.query(sql, tuple(params))
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["options"] = json.loads(r["options_json"] or "[]")
        except ValueError:
            d["options"] = []
        d["nextReviewLabel"] = _ms_to_date_label(r["next_review_at"])
        d.pop("options_json", None)
        out.append(d)
    return out


def wrong_modules() -> list[dict]:
    rows = storage.query(
        "SELECT module_name, COUNT(*) c FROM wrong_questions "
        "WHERE status='active' GROUP BY module_name ORDER BY c DESC")
    return [{"name": r["module_name"] or "未分类", "count": r["c"]} for r in rows]


def wrong_record_answer(payload: dict | None = None) -> dict:
    """记录错题复习时的作答（payload: {id, answer}），持久化到 my_answer。"""
    payload = payload or {}
    wrong_id = int(payload.get("id"))
    answer = str(payload.get("answer", "")).strip()
    row = storage.query_one(
        "SELECT id FROM wrong_questions WHERE id=?", (wrong_id,))
    if not row:
        raise RuntimeError("错题不存在。")
    storage.execute(
        "UPDATE wrong_questions SET my_answer=? WHERE id=?",
        (answer, wrong_id))
    return {"id": wrong_id, "myAnswer": answer}


def wrong_action(wrong_id: int, action: str) -> dict:
    row = storage.query_one(
        "SELECT * FROM wrong_questions WHERE id=?", (int(wrong_id),))
    if not row:
        raise RuntimeError("错题不存在。")
    t = storage.now_ms()
    if action == "review":
        mastery = min(95, (row["mastery"] or 0) + 25)
        days = 1 if mastery <= 40 else (3 if mastery <= 70 else 7)
        nxt = t + days * 86400 * 1000
        storage.execute(
            "UPDATE wrong_questions SET mastery=?,last_review_at=?,next_review_at=? "
            "WHERE id=?", (mastery, t, nxt, wrong_id))
        return {"mastery": mastery, "nextReviewLabel": _ms_to_date_label(nxt)}
    if action == "master":
        storage.execute(
            "UPDATE wrong_questions SET status='mastered',mastery=100,"
            "last_review_at=?,next_review_at=NULL WHERE id=?", (t, wrong_id))
        return {"status": "mastered"}
    if action == "reactivate":
        storage.execute(
            "UPDATE wrong_questions SET status='active',next_review_at=? WHERE id=?",
            (t + 86400 * 1000, wrong_id))
        return {"status": "active"}
    raise RuntimeError(f"未知操作：{action}")


def wrong_sync(payload: dict | None = None) -> dict:
    """从粉笔云端同步错题（payload: {prefix?, module?}），逐块落库并推送进度事件。"""
    payload = payload or {}
    prefix = payload.get("prefix", "xingce") or "xingce"
    module = payload.get("module", "") or ""

    def on_progress(done: int, total: int, phase: str) -> None:
        events.emit("wrongSync:progress",
                    {"done": done, "total": total, "phase": phase})

    return fenbi_svc.sync_wrong(prefix, module, on_progress=on_progress)


# ================================================================== 笔记 ====
def notes_list(query: str = "") -> list[dict]:
    sql = "SELECT * FROM notes"
    params: tuple = ()
    if query:
        sql += " WHERE title LIKE ? OR body LIKE ? OR tags LIKE ?"
        params = (f"%{query}%", f"%{query}%", f"%{query}%")
    sql += " ORDER BY updated_at DESC"
    return storage.rows_to_dicts(storage.query(sql, params))


def notes_save(note: dict) -> dict:
    t = storage.now_ms()
    nid = note.get("id")
    if nid:
        storage.execute(
            "UPDATE notes SET title=?,body=?,tags=?,linked_global=?,updated_at=? "
            "WHERE id=?",
            (note.get("title", "无标题"), note.get("body", ""), note.get("tags", ""),
             note.get("linked_global", ""), t, nid))
        return {"id": nid}
    new_id = storage.insert(
        "INSERT INTO notes(title,body,tags,linked_global,created_at,updated_at) "
        "VALUES(?,?,?,?,?,?)",
        (note.get("title", "无标题"), note.get("body", ""), note.get("tags", ""),
         note.get("linked_global", ""), t, t))
    return {"id": new_id}


def notes_delete(note_id: int) -> None:
    storage.execute("DELETE FROM notes WHERE id=?", (int(note_id),))


def _prepare_pdf_font() -> tuple[str, str]:
    """返回 (@font-face CSS 片段, 基础字体名)。优先系统黑体类 TTF（可嵌入），
    文件不可读时注册 reportlab 内置 CID 宋体 STSong-Light（无需字体文件）。"""
    for path in (r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\simkai.ttf",
                 r"C:\Windows\Fonts\simfang.ttf", r"C:\Windows\Fonts\Deng.ttf"):
        if not os.path.exists(path):
            continue
        try:
            with open(path, "rb"):
                pass
        except OSError:
            continue
        url = path.replace("\\", "/")
        _patch_mono_alias("CNFont")
        return (f"@font-face {{ font-family: CNFont; src: url('{url}'); }}", "CNFont")
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    except Exception:
        pass
    _patch_mono_alias("STSong-Light")
    return "", "STSong-Light"


def _patch_mono_alias(font: str) -> None:
    """xhtml2pdf 默认样式表把 code/pre 映射到 Courier New（不含中文字形），
    改为映射到能画中文的字体，避免行内代码出现空白方块。"""
    try:
        from xhtml2pdf import default as pisa_default
        for alias in ("courier new", "monospace", "mono", "monospaced",
                      "ui-monospace"):
            pisa_default.DEFAULT_FONT[alias] = font
    except Exception:
        pass


def notes_export_pdf(note_id: int) -> dict:
    """将笔记渲染为 PDF 并弹出保存对话框。"""
    row = storage.query_one("SELECT * FROM notes WHERE id=?", (int(note_id),))
    if not row:
        raise RuntimeError("笔记不存在，请先保存后再导出。")
    try:
        import markdown as md_mod
        from xhtml2pdf import pisa
    except ImportError as e:
        raise RuntimeError("缺少 PDF 组件，请先执行：pip install markdown xhtml2pdf") from e

    body_html = md_mod.markdown(row["body"] or "", extensions=["extra", "nl2br"])
    font_face, base_font = _prepare_pdf_font()
    title = row["title"] or "无标题"
    html = f"""<html><head><meta charset="utf-8"><style>
    @page {{ size: A4; margin: 2cm 1.8cm; }}
    {font_face}
    * {{ font-family: {base_font}; }}
    body {{ font-size: 10.5pt; color: #24292f; line-height: 1.75; }}
    h1,h2,h3,h4,h5,h6 {{ color: #111; margin: 14px 0 6px; }}
    h1 {{ font-size: 19pt; }} h2 {{ font-size: 15.5pt; }} h3 {{ font-size: 13pt; }}
    code {{ background: #f2f3f7; font-size: 9.5pt; font-family: {base_font}; }}
    pre {{ background: #f2f3f7; padding: 8px; font-size: 9.5pt; font-family: {base_font}; }}
    blockquote {{ color: #555; border-left: 3px solid #c9ced6; padding-left: 10px; }}
    table {{ border-collapse: collapse; }}
    th, td {{ border: 1px solid #c9ced6; padding: 4px 8px; }}
    ul, ol {{ margin: 4px 0 8px 18px; }}
    </style></head><body>
    <h1>{_esc(title)}</h1>
    <p style="color:#8a919c; font-size:9pt">上岸助手 · 导出于 {time.strftime('%Y-%m-%d %H:%M')}</p>
    <hr>
    {body_html}
    </body></html>"""

    buf = io.BytesIO()
    kwargs: dict = {}
    try:  # 新版 xhtml2pdf 限制文档只能读基目录，需把系统字体目录加入白名单
        from pathlib import Path
        from xhtml2pdf.config.resources import ResourceAccessPolicy
        kwargs["resource_policy"] = ResourceAccessPolicy(
            extra_roots=(Path("C:/Windows/Fonts"),))
    except ImportError:
        pass
    status = pisa.CreatePDF(html, dest=buf, encoding="utf-8", **kwargs)
    if status.err:
        raise RuntimeError("PDF 生成失败，请重试。")

    window = webview.windows[0]
    safe = re.sub(r'[\\/:*?"<>|]', "_", title).strip()[:40] or "笔记"
    result = window.create_file_dialog(
        webview.SAVE_DIALOG,
        save_filename=f"{safe}.pdf",
        file_types=("PDF 文件 (*.pdf)",))
    if not result:
        return {"cancelled": True}
    target = result if isinstance(result, str) else result[0]
    with open(target, "wb") as f:
        f.write(buf.getvalue())
    return {"path": target}


# ================================================================== 计划 ====
def plan_overview(month_offset: int = 0) -> dict:
    today = date.today()
    first = (today.replace(day=1) + timedelta(days=32 * month_offset)).replace(day=1)
    n_days = calendar.monthrange(first.year, first.month)[1]
    checkins = {
        r["date"] for r in storage.query("SELECT date FROM checkins")
    }

    cells: list[dict] = []
    for i in range(first.weekday()):
        cells.append({"empty": True})
    for day in range(1, n_days + 1):
        ds = f"{first.year}-{first.month:02d}-{day:02d}"
        cells.append({
            "day": day,
            "checked": ds in checkins,
            "isToday": ds == today.strftime("%Y-%m-%d"),
        })

    # 近 7 天学习分钟
    bars = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        s0 = int(time.mktime(d.timetuple()) * 1000)
        s1 = s0 + 86400 * 1000
        sess = storage.query_one(
            "SELECT COALESCE(SUM(duration_sec),0) s FROM practice_sessions "
            "WHERE finished_at>=? AND finished_at<?", (s0, s1))["s"]
        focus = storage.query_one(
            "SELECT COALESCE(SUM(duration_sec),0) s FROM focus_logs "
            "WHERE started_at>=? AND started_at<?", (s0, s1))["s"]
        bars.append({"label": ["一","二","三","四","五","六","日"][d.weekday()],
                     "minutes": round((sess + focus) / 60)})

    general = storage.get_setting("general")
    countdown = None
    if general.get("exam_date"):
        try:
            ed = datetime.strptime(general["exam_date"], "%Y-%m-%d").date()
            countdown = {"days": (ed - today).days,
                         "name": general.get("exam_name", "考试")}
        except ValueError:
            pass

    return {"monthLabel": f"{first.year}年{first.month}月", "cells": cells,
            "bars": bars, "countdown": countdown}


def tasks_list(day: str = "") -> list[dict]:
    day = day or storage.today_str()
    return storage.rows_to_dicts(storage.query(
        "SELECT * FROM tasks WHERE date=? ORDER BY required DESC,id", (day,)))


def tasks_save(task: dict) -> dict:
    day = task.get("date") or storage.today_str()
    tid = task.get("id")
    if tid:
        storage.execute(
            "UPDATE tasks SET title=?,detail=?,duration_min=?,required=? WHERE id=?",
            (task.get("title", ""), task.get("detail", ""),
             int(task.get("duration_min", 0) or 0),
             1 if task.get("required") else 0, tid))
        return {"id": tid}
    new_id = storage.insert(
        "INSERT INTO tasks(date,title,detail,duration_min,required,source,"
        "created_at) VALUES(?,?,?,?,?,'manual',?)",
        (day, task.get("title", ""), task.get("detail", ""),
         int(task.get("duration_min", 0) or 0),
         1 if task.get("required") else 0, storage.now_ms()))
    return {"id": new_id}


def tasks_toggle(task_id: int) -> dict:
    row = storage.query_one("SELECT * FROM tasks WHERE id=?", (int(task_id),))
    if not row:
        raise RuntimeError("任务不存在。")
    if row["status"] == "done":
        storage.execute("UPDATE tasks SET status='todo',finished_at=NULL WHERE id=?",
                        (task_id,))
        return {"status": "todo"}
    storage.execute("UPDATE tasks SET status='done',finished_at=? WHERE id=?",
                    (storage.now_ms(), task_id))
    storage.insert("INSERT OR IGNORE INTO checkins(date,created_at) VALUES(?,?)",
                   (storage.today_str(), storage.now_ms()))
    return {"status": "done"}


def tasks_delete(task_id: int) -> None:
    storage.execute("DELETE FROM tasks WHERE id=?", (int(task_id),))


def tasks_ai_generate() -> list[dict]:
    general = storage.get_setting("general")
    rpt = reports.build_report("week")
    system = (
        "你是公考督学老师。根据学生的考试信息和本周数据，为今天安排3-5个学习任务。"
        "只输出JSON数组，每个元素含 title(任务名,15字内), duration_min(分钟数),"
        "required(是否今日必做,布尔值), detail(一句话说明为什么安排)。不要输出其他文字。"
    )
    user = json.dumps({
        "考试": general.get("exam_name"),
        "距考试天数": (
            (datetime.strptime(general["exam_date"], "%Y-%m-%d").date() - date.today()).days
            if general.get("exam_date") else None),
        "本周刷题": rpt["questions"],
        "本周正确率": f'{rpt["accuracy"]}%',
        "薄弱模块": [f'{m["name"]}{m["accuracy"]}%' for m in rpt["modules"][:2]],
        "待复习错题数": storage.query_one(
            "SELECT COUNT(*) c FROM wrong_questions WHERE status='active'")["c"],
    }, ensure_ascii=False)
    text = ai_svc.chat_text(system, user, temperature=0.4)
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        raise RuntimeError("AI 返回内容无法解析，请重试。")
    try:
        arr = json.loads(m.group(0))
    except ValueError:
        raise RuntimeError("AI 返回的任务格式有误，请重试。")

    today = storage.today_str()
    existing = {r["title"] for r in storage.query(
        "SELECT title FROM tasks WHERE date=?", (today,))}
    for t in arr:
        title = str(t.get("title", "")).strip()
        if not title or title in existing:
            continue
        storage.insert(
            "INSERT INTO tasks(date,title,detail,duration_min,required,source,"
            "created_at) VALUES(?,?,?,?,?,'ai',?)",
            (today, title, str(t.get("detail", "")),
             int(t.get("duration_min", 30) or 30),
             1 if t.get("required") else 0, storage.now_ms()))
        existing.add(title)
    return tasks_list(today)


def focus_save(duration_sec: int, title: str = "专注学习") -> dict:
    if int(duration_sec) < 10:
        raise RuntimeError("时长太短，无法记录。")
    storage.insert(
        "INSERT INTO focus_logs(date,started_at,duration_sec,title) VALUES(?,?,?,?)",
        (storage.today_str(), storage.now_ms() - int(duration_sec) * 1000,
         int(duration_sec), title))
    return {"ok": True}


# ================================================================== 报告 ====
def report_data(period: str = "week") -> dict:
    return reports.build_report(period)


def report_ai_review(period: str = "week") -> str:
    return reports.ai_review(period)


_last_poster = {"path": ""}


def share_generate(period: str = "week", privacy: dict | None = None) -> dict:
    privacy = privacy or storage.get_setting("privacy")
    out = os.path.join(os.path.dirname(storage.db_file()),
                       f"poster_{period}_{int(time.time())}.png")
    reports.make_poster(period, privacy, out)
    _last_poster["path"] = out
    with open(out, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return {"dataUrl": f"data:image/png;base64,{b64}", "path": out}


def share_save(channel: str = "保存海报") -> dict:
    src = _last_poster["path"]
    if not src or not os.path.exists(src):
        raise RuntimeError("请先生成海报。")
    window = webview.windows[0]
    result = window.create_file_dialog(
        webview.SAVE_DIALOG,
        save_filename=f"学习报告_{time.strftime('%Y%m%d')}.png",
        file_types=("PNG 图片 (*.png)",),
    )
    if not result:
        return {"cancelled": True}
    target = result if isinstance(result, str) else result[0]
    shutil.copy(src, target)
    storage.insert(
        "INSERT INTO share_records(created_at,period,channel,file_path) "
        "VALUES(?,?,?,?)",
        (storage.now_ms(), "week", channel, target))
    return {"path": target}


# ================================================================== 设置 ====
def model_test(cfg: dict) -> dict:
    return ai_svc.test_connection(cfg)


def model_save(cfg: dict) -> None:
    storage.set_setting("model", cfg)


def privacy_save(privacy: dict) -> None:
    storage.set_setting("privacy", privacy)


def fenbi_save_cookie(cookie: str) -> dict:
    cookie = (cookie or "").strip()
    storage.set_setting("fenbi_cookie", cookie)
    info = fenbi_svc.whoami()
    events.emit("toast", {"kind": "ok", "title": "粉笔账号已连接",
                          "text": "Cookie 有效，可以开始刷题了。"})
    return info


def fenbi_logout() -> dict:
    """退出粉笔登录：清本地凭据、重置客户端，并清掉网页登录态（便于切换账号）。
    错题、笔记、计划等本地学习数据保留。"""
    global _login_window
    # 关闭可能仍在等待的登录窗口（标记 done 以抑制 closed 事件与轮询）
    win = _login_window
    _login_window = None
    if win is not None:
        _login_state["done"] = True
        try:
            win.destroy()
        except Exception:
            pass

    storage.set_setting("fenbi_cookie", "")
    fenbi_svc.reset_session()

    # 清除 WebView2 中保存的粉笔网页 Cookie；主窗口为本地页面，无需要保留的 Cookie
    if HAS_WEBVIEW:
        for w in webview.windows:
            try:
                w.clear_cookies()
                break
            except Exception:
                continue

    events.emit("toast", {"kind": "info", "title": "已退出粉笔账号",
                          "text": "本地学习数据已保留，可随时重新扫码登录。"})
    return {"ok": True}


# ----------------------------------------------- 扫码 / 网页登录 ----------
FENBI_LOGIN_URL = "https://www.fenbi.com/page/home"
_COOKIE_KEY_ORDER = ("device_id", "sid", "persistent", "sess", "userid")
_LOGIN_POLL_INTERVAL = 1.5          # 轮询 Cookie 的间隔（秒）
_LOGIN_TIMEOUT = 600                # 最长等待 10 分钟
_login_window = None
_login_state = {"done": False, "polling": False}


def fenbi_debug_cookies() -> dict:
    """导出登录窗口的真实 Cookie 证据（给前端调试按钮显示用）。

    同时展示两路来源：原生 CookieManager（含 HttpOnly，等价请求头
    Cookie 字段）与 document.cookie（只有非 HttpOnly 的统计键）。"""
    w = _login_window
    if w is None:
        return {"url": "(登录窗口未打开)", "keys": [], "docCookie": "",
                "nativeCookie": "", "source": "登录窗口未打开",
                "has_sid": False, "has_userid": False, "cookie_count": 0}
    try:
        url = w.get_current_url() or ""
    except Exception as e:
        url = f"<get_current_url 异常: {e!r}>"

    doc_cookie = ""
    try:
        doc_cookie = w.evaluate_js("document.cookie") or ""
    except Exception as e:
        doc_cookie = f"<evaluate_js 异常: {e!r}>"
    js_pairs = _parse_cookie_str(doc_cookie)

    # 原生 CookieManager：能读到 HttpOnly（sid/userid/persistent/sess 等）
    native_pairs: dict[str, str] = {}
    native_err = ""
    try:
        native_pairs = _extract_fenbi_cookies(w.get_cookies() or [])
    except Exception as e:
        native_err = repr(e)

    if native_pairs:
        source = "原生 CookieManager（含 HttpOnly）"
    elif js_pairs:
        source = "仅 document.cookie（登录键为 HttpOnly，JS 读不到）"
    else:
        source = "两路均为空" + (f"（原生异常: {native_err}）" if native_err else "")

    return {
        "url": url,
        "docCookie": doc_cookie,
        "nativeCookie": _ordered_cookie_str(native_pairs),
        "keys": sorted(set(native_pairs) | set(js_pairs)),
        "has_sid": bool(native_pairs.get("sid") or js_pairs.get("sid")),
        "has_userid": bool(native_pairs.get("userid") or js_pairs.get("userid")),
        "cookie_count": len(native_pairs),
        "source": source,
    }


def _extract_fenbi_cookies(cookies) -> dict[str, str]:
    """从浏览器原生 Cookie 列表中挑出粉笔域名下的键值对（含 HttpOnly）。

    pywebview 6.x 的 get_cookies() 返回 SimpleCookie 列表，每个元素含一个
    Morsel：键在 morsel.key、值在 morsel.value、域在 morsel["domain"]。
    这是唯一能读到 HttpOnly 登录 Cookie（sid/userid 等）的通道。"""
    from http.cookies import SimpleCookie

    pairs: dict[str, str] = {}
    for ck in cookies or []:
        morsels = ck.values() if isinstance(ck, SimpleCookie) else [ck]
        for m in morsels:
            name = getattr(m, "key", None) or getattr(m, "name", None)
            value = getattr(m, "value", None)
            if not name or value is None:
                continue
            if isinstance(ck, SimpleCookie):
                domain = (m["domain"] or "").lower()
            else:
                domain = (getattr(m, "domain", "") or "").lower()
            if "fenbi.com" in domain or "yuantiku.com" in domain:
                pairs[name] = value
    return pairs


def _ordered_cookie_str(pairs: dict[str, str]) -> str:
    """按请求头格式组 Cookie 串：登录关键键排最前，其余键保持原顺序。"""
    ordered: dict[str, str] = {}
    for key in _COOKIE_KEY_ORDER:
        if key in pairs:
            ordered[key] = pairs[key]
    for k, v in pairs.items():
        ordered.setdefault(k, v)
    return "; ".join(f"{k}={v}" for k, v in ordered.items())


def _save_fenbi_cookie(pairs: dict[str, str]) -> dict:
    cookie_str = "; ".join(f"{k}={v}" for k, v in pairs.items())
    storage.set_setting("fenbi_cookie", cookie_str)
    return fenbi_svc.whoami()


def _close_login_window(win) -> None:
    global _login_window
    _login_window = None
    try:
        win.destroy()
    except Exception:
        pass


# WebView2 ready 标记（pywebview 在 CoreWebView2 初始化完成后会把窗口 js_api 注入，
# 这是我们能检测到的最可靠的 "CoreWebView2 已 ready" 信号）
_webview_ready_event = threading.Event()


def _query_all_fenbi_cookies(win) -> str:
    """拿浏览器请求头格式的 Cookie 串（name=value; name2=value2）。

    根因：sid/persistent/sess/userid/device_id 都是 HttpOnly，
    document.cookie 永远读不到（此前轮询只拿到 5 个统计 Cookie 的原因）。
    必须走原生 get_cookies()——CoreWebView2 CookieManager 直读浏览器
    Cookie 存储，HttpOnly 一并可读；evaluate_js 仅作最后兜底。"""
    # 1) 原生 CookieManager：等价于 F12 请求头里的 Cookie 字段
    try:
        pairs = _extract_fenbi_cookies(win.get_cookies() or [])
        if pairs:
            return _ordered_cookie_str(pairs)
    except Exception as e:
        print(f"[fenbi] get_cookies 原生读取失败: {e!r}")

    # 2) 兜底：JS 只能看到非 HttpOnly 的统计 Cookie（通常不含登录态）
    try:
        return win.evaluate_js("document.cookie") or ""
    except Exception as e:
        print(f"[fenbi] document.cookie evaluate_js 失败: {e!r}")
        return ""


def _parse_cookie_str(cookie_str: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for chunk in (cookie_str or "").split(";"):
        chunk = chunk.strip()
        if not chunk or "=" not in chunk:
            continue
        k, _, v = chunk.partition("=")
        out[k.strip()] = v.strip()
    return out


def _wait_window_ready(win, timeout: float = 15.0) -> bool:
    """等登录窗口 CoreWebView2 ready 并且页面首帧渲染完成。
    pywebview 的 create_window 是异步的，CoreWebView2.InitializationCompleted
    要等 EventLoop 跑一次才触发，后台线程直接抓 Cookie 会拿到空/抛异常。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _login_window is not win:
            return False
        try:
            # evaluate_js 跨线程安全且在 CoreWebView2 没 ready 时会抛异常
            ok = win.evaluate_js("typeof window !== 'undefined'")
            if ok:
                return True
        except Exception:
            pass
        time.sleep(0.4)
    return False


def _poll_login_cookies(win) -> None:
    """后台轮询登录窗口 Cookie，发现登录态后自动保存、验证、关窗。"""
    _login_state["polling"] = True
    try:
        # 先等 CoreWebView2 ready + 页面首帧——这步在之前的实现里是缺失的！
        if not _wait_window_ready(win):
            events.emit("fenbiLogin:timeout",
                        {"text": "登录窗口加载超时，请重新点【打开粉笔登录页】。"})
            return

        deadline = time.time() + _LOGIN_TIMEOUT
        error_mark = ""        # 已向用户提示过验证失败的指纹
        fail_rounds = 0        # whoami 连续失败轮数
        while time.time() < deadline:
            if _login_window is not win:
                return  # 窗口已关闭或已被新窗口替代
            try:
                cookie_str = _query_all_fenbi_cookies(win)
            except Exception as e:
                print(f"[fenbi] _query_all_fenbi_cookies 异常: {e!r}")
                time.sleep(_LOGIN_POLL_INTERVAL)
                continue

            pairs = _parse_cookie_str(cookie_str)
            # 登录判定：网页登录态关键键出现即可（sid 由题库接口服务端
            # 下发，登录页上没有，不能作为前置条件）。
            userid = pairs.get("userid", "")
            has_sess = bool(pairs.get("sess") or pairs.get("persistent"))
            mark = f"{userid}|{pairs.get('sess', '')}|{pairs.get('persistent', '')}"
            if userid and has_sess:
                # 直接拿原生读到的整段 Cookie 保存，用 whoami 真实验证；
                # 未通过就下一轮再验（服务端可能还在补发会话 Cookie）
                try:
                    info = _save_fenbi_cookie(pairs)
                except Exception as e:
                    print(f"[fenbi] whoami 验证异常: {e!r}")
                    info = None
                if (info or {}).get("user"):
                    _login_state["done"] = True
                    name = ""
                    try:
                        name = (info.get("user") or {}).get("name", "") or ""
                    except AttributeError:
                        name = ""
                    _close_login_window(win)
                    events.emit("fenbiLogin:success", {"info": info, "name": name})
                    events.emit("toast", {"kind": "ok", "title": "粉笔账号已连接",
                                          "text": f"欢迎回来{('，' + name) if name else ''}，可以开始刷题了。"})
                    return
                # 原生 Cookie 已是登录态但接口验证未过：刷新登录页促发
                # 页面自身的接口调用（服务端可能补发 sid 等会话 Cookie）
                fail_rounds += 1
                if fail_rounds % 4 == 2:
                    try:
                        win.load_url(FENBI_LOGIN_URL)
                    except Exception:
                        pass
                if mark != error_mark:
                    error_mark = mark
                    events.emit(
                        "fenbiLogin:error",
                        {"text": "已检测到网页登录，正在等待题库接口验证通过"
                                 "（通常几秒内自动完成），请保持本窗口打开。"})
            time.sleep(_LOGIN_POLL_INTERVAL)

        events.emit("fenbiLogin:timeout",
                    {"text": "等待登录超时，可重新点【打开粉笔登录页】再试。"})
    finally:
        _login_state["polling"] = False


def _start_login_window() -> object:
    """创建粉笔登录窗口并启动自动轮询，返回窗口对象。"""
    global _login_window, _login_state
    win = webview.create_window(
        "登录粉笔账号（支持粉笔 App 扫码，登录成功后自动完成）",
        FENBI_LOGIN_URL,
        width=1100,
        height=800,
    )
    _login_state = {"done": False, "polling": False}

    def _on_closed():
        global _login_window
        _login_window = None
        # 成功后的自动关窗不再通知，避免把成功态覆盖掉
        if not _login_state["done"]:
            events.emit("fenbiLogin:closed", {})

    win.events.closed += _on_closed
    _login_window = win
    threading.Thread(target=_poll_login_cookies, args=(win,), daemon=True).start()
    return win


def fenbi_open_login_page() -> dict:
    """打开粉笔官方登录窗口（支持 App 扫码/手机号登录），登录成功后自动获取。"""
    if not HAS_WEBVIEW:
        raise RuntimeError("当前平台由原生登录页处理，请直接点击登录按钮。")
    global _login_window
    if _login_window is not None:
        try:
            _login_window.show()
            # 旧窗口的轮询可能已超时退出，需要补一个
            if not _login_state["polling"]:
                threading.Thread(
                    target=_poll_login_cookies, args=(_login_window,),
                    daemon=True).start()
            return {"ok": True}
        except Exception:
            _login_window = None

    _start_login_window()
    return {"ok": True}


def fenbi_cancel_login_page() -> dict:
    """前端放弃等待时调用：登录窗口若仍开着则关闭。"""
    global _login_window
    win = _login_window
    _login_window = None
    if win is not None:
        try:
            win.destroy()
        except Exception:
            pass
    return {"ok": True}


def fenbi_finish_login_page() -> dict:
    """手动兜底：立即抓取一次登录窗口 Cookie 并验证保存。

    判定与自动轮询一致：网页登录态键（userid + sess/persistent）即可，
    保存后以 whoami 真实验证为准；sid 由题库接口服务端下发，不作前置。"""
    win = _login_window
    if win is None:
        raise RuntimeError("请先点【打开粉笔登录页】。")

    cookie_str = _query_all_fenbi_cookies(win)
    pairs = _parse_cookie_str(cookie_str)
    if not pairs.get("userid") or not (pairs.get("sess") or pairs.get("persistent")):
        raise RuntimeError(
            f"还没检测到登录状态。浏览器当前 Cookie 里只有："
            f"{', '.join(list(pairs.keys())) or '（空）'}。"
            f"请在弹出的粉笔页面完成登录后再点此按钮。"
        )

    info = _save_fenbi_cookie(pairs)
    if not (info or {}).get("user"):
        raise RuntimeError(
            "已取到网页登录 Cookie，但题库接口验证暂未通过（服务端可能还在"
            "下发会话），请稍等几秒后再点一次。")
    _login_state["done"] = True
    _close_login_window(win)
    name = ""
    try:
        name = (info.get("user") or {}).get("name", "") or ""
    except AttributeError:
        name = ""
    events.emit("fenbiLogin:success", {"info": info, "name": name})
    return info


def general_save(general: dict) -> None:
    storage.set_setting("general", general)


def backup_export() -> dict:
    if not HAS_WEBVIEW:
        return backup_export_b64()
    target_dialog = webview.windows[0].create_file_dialog(
        webview.SAVE_DIALOG,
        save_filename=f"fenbi_backup_{time.strftime('%Y%m%d')}.db",
        file_types=("数据库备份 (*.db)",),
    )
    if not target_dialog:
        return {"cancelled": True}
    target = target_dialog if isinstance(target_dialog, str) else target_dialog[0]
    storage.checkpoint_close()
    shutil.copy(storage.db_file(), target)
    return {"path": target}


PENDING_RESTORE = os.path.join(
    os.path.dirname(storage.db_file()), "pending_restore.db")


def backup_export_b64() -> dict:
    """无文件对话框宿主（Android）：返回整库备份 base64，由前端触发下载。"""
    storage.checkpoint_close()
    with open(storage.db_file(), "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    return {"filename": f"fenbi_backup_{time.strftime('%Y%m%d')}.db",
            "data": data}


def backup_import_b64(data: str) -> dict:
    """无文件对话框宿主（Android）：接收 base64 备份并热替换数据库。"""
    tmp = PENDING_RESTORE + ".b64tmp"
    with open(tmp, "wb") as f:
        f.write(base64.b64decode(data))
    conn = sqlite3.connect(tmp)
    try:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()
    if "kv_settings" not in tables:
        os.remove(tmp)
        raise RuntimeError("所选文件不是有效的备份。")
    storage.replace_db(tmp)
    os.remove(tmp)
    return {"restored": True}


def backup_import() -> dict:
    if not HAS_WEBVIEW:
        raise RuntimeError("当前平台请通过文件选择导入备份。")
    src_dialog = webview.windows[0].create_file_dialog(
        webview.OPEN_DIALOG, file_types=("数据库备份 (*.db)",))
    if not src_dialog:
        return {"cancelled": True}
    src = src_dialog if isinstance(src_dialog, str) else src_dialog[0]
    # 校验备份文件
    conn = sqlite3.connect(src)
    try:
        tables = {
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        conn.close()
    if "kv_settings" not in tables:
        raise RuntimeError("所选文件不是有效的备份。")
    shutil.copy(src, PENDING_RESTORE)
    return {"needRestart": True}


# ================================================================== 对话 ====
SYS_PROMPTS = {
    "practice": (
        "你叫小岸，是公考私教。规则：①不直接报答案，先用提问引导学生自己判断；"
        "②学生明确要求讲解时，按「判断题型→找特征→推规律→定答案」分步讲；"
        "③讲完给一句好记的口诀。语气像耐心的朋友。"
    ),
    "wrong": (
        "你叫小岸，是公考私教。针对错题：先判断错因类型（知识盲区/概念混淆/"
        "审题失误/方法错误/粗心），再解释误区，给出针对性练习建议。"
        "不要空泛安慰，要具体到这道题。"
    ),
    "plan": (
        "你叫小岸，是公考督学老师。帮助学生安排和调整学习计划，兼顾可执行性。"
        "学生请假或顺延任务时，主动给出替代安排，并鼓励保持连续打卡。"
    ),
    "notes": (
        "你叫小岸，是公考私教。帮助学生整理笔记、压缩记忆点、出检测题。"
    ),
    "report": (
        "你叫小岸，是公考私教。结合学习报告数据解读亮点与短板，并把建议落成"
        "可执行的任务。"
    ),
    "general": (
        "你叫小岸，是公考私教。围绕公务员考试备考回答问题，简洁具体。"
    ),
}


def chat_history(limit: int = 30) -> list[dict]:
    rows = storage.query(
        "SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?", (int(limit),))
    return list(reversed(storage.rows_to_dicts(rows)))


def chat_clear() -> None:
    storage.execute("DELETE FROM chat_messages")


def chat_send(payload: dict) -> dict:
    text = (payload.get("text") or "").strip()
    if not text:
        raise RuntimeError("消息不能为空。")
    ctx_type = payload.get("ctxType") or "general"
    ctx_data = payload.get("ctxData") or {}

    storage.insert(
        "INSERT INTO chat_messages(role,content,ctx_type,created_at) "
        "VALUES(?,?,?,?)",
        ("user", text, ctx_type, storage.now_ms()))
    mid = storage.insert(
        "INSERT INTO chat_messages(role,content,ctx_type,created_at) "
        "VALUES('assistant','',?,?)",
        (ctx_type, storage.now_ms()))

    history_rows = storage.query(
        "SELECT role,content FROM chat_messages WHERE id<? "
        "ORDER BY id DESC LIMIT 12", (mid,))
    history_rows = list(reversed(history_rows))
    messages = [{"role": "system", "content": SYS_PROMPTS.get(
        ctx_type, SYS_PROMPTS["general"])}]
    for r in history_rows:
        if r["content"]:
            messages.append({"role": r["role"], "content": r["content"]})
    if ctx_data:
        messages[-1] = {
            "role": "user",
            "content": "【当前上下文】\n"
                       + json.dumps(ctx_data, ensure_ascii=False)
                       + "\n\n" + text,
        }

    def worker() -> None:
        def on_delta(piece: str) -> None:
            events.emit("chat:delta", {"id": mid, "piece": piece})

        def on_done(full: str) -> None:
            storage.execute("UPDATE chat_messages SET content=? WHERE id=?",
                            (full, mid))
            events.emit("chat:done", {"id": mid})

        def on_error(e: str) -> None:
            events.emit("chat:error", {"id": mid, "error": e})

        ai_svc.stream_chat(messages, on_delta, on_done, on_error)

    threading.Thread(target=worker, daemon=True).start()
    return {"id": mid}
