# -*- coding: utf-8 -*-
"""学习报告聚合统计 + Pillow 海报生成。"""
from __future__ import annotations

import calendar
import json
import os
import time
from datetime import date, datetime, timedelta

from PIL import Image, ImageDraw, ImageFont

from . import ai_svc, storage


# ------------------------------------------------------------- 时间范围 ----
def _day_start(d: date) -> int:
    return int(time.mktime(d.timetuple()) * 1000)


def range_of(period: str) -> tuple[int, int, str]:
    today = date.today()
    if period == "week":
        monday = today - timedelta(days=today.weekday())
        return _day_start(monday), _day_start(today + timedelta(days=1)), "本周"
    if period == "last_week":
        monday = today - timedelta(days=today.weekday() + 7)
        sunday = monday + timedelta(days=7)
        return _day_start(monday), _day_start(sunday), "上周"
    if period == "month":
        first = today.replace(day=1)
        if today.month == 12:
            nxt = today.replace(year=today.year + 1, month=1, day=1)
        else:
            nxt = today.replace(month=today.month + 1, day=1)
        return _day_start(first), _day_start(nxt), f"{today.year}年{today.month}月"
    # 默认近 30 天
    start = today - timedelta(days=30)
    return _day_start(start), _day_start(today + timedelta(days=1)), "近30天"


# ------------------------------------------------------------- 聚合统计 ----
def _streak() -> int:
    rows = storage.query("SELECT date FROM checkins")
    days = {r["date"] for r in rows}
    n = 0
    d = date.today()
    while d.strftime("%Y-%m-%d") in days:
        n += 1
        d -= timedelta(days=1)
    return n


def _wrong_trend() -> list[dict]:
    """近 8 周每周新增错题（答错题数）。"""
    today = date.today()
    this_monday = today - timedelta(days=today.weekday())
    weeks: list[dict] = []
    for i in range(7, -1, -1):
        ws = this_monday - timedelta(weeks=i)
        we = ws + timedelta(weeks=1)
        row = storage.query_one(
            "SELECT COUNT(*) c FROM question_results WHERE correct=0 "
            "AND created_at>=? AND created_at<?",
            (_day_start(ws), _day_start(we)),
        )
        weeks.append({"label": f"W{ws.isocalendar().week}", "value": row["c"]})
    return weeks


def build_report(period: str) -> dict:
    start_ts, end_ts, label = range_of(period)

    totals = storage.query_one(
        "SELECT COUNT(*) total, COALESCE(SUM(correct),0) correct "
        "FROM question_results WHERE created_at>=? AND created_at<?",
        (start_ts, end_ts),
    )
    total_q = totals["total"]
    correct_q = totals["correct"]
    accuracy = round(correct_q * 100 / total_q) if total_q else 0

    module_rows = storage.query(
        "SELECT module_name, COUNT(*) total, SUM(correct) correct "
        "FROM question_results WHERE created_at>=? AND created_at<? "
        "GROUP BY module_name",
        (start_ts, end_ts),
    )
    modules = [
        {
            "name": r["module_name"] or "未分类",
            "total": r["total"],
            "accuracy": round(r["correct"] * 100 / r["total"]) if r["total"] else 0,
        }
        for r in module_rows
    ]
    modules.sort(key=lambda m: -m["accuracy"])

    sess_sec = storage.query_one(
        "SELECT COALESCE(SUM(duration_sec),0) s FROM practice_sessions "
        "WHERE finished_at>=? AND finished_at<?",
        (start_ts, end_ts),
    )["s"]
    focus_sec = storage.query_one(
        "SELECT COALESCE(SUM(duration_sec),0) s FROM focus_logs "
        "WHERE started_at>=? AND started_at<?",
        (start_ts, end_ts),
    )["s"]
    hours = round((sess_sec + focus_sec) / 3600, 1)

    return {
        "period": period,
        "periodLabel": label,
        "questions": total_q,
        "correct": correct_q,
        "accuracy": accuracy,
        "hours": hours,
        "streak": _streak(),
        "modules": modules,
        "wrongTrend": _wrong_trend(),
    }


def ai_review(period: str) -> str:
    rpt = build_report(period)
    general = storage.get_setting("general")
    exam_days = ""
    if general.get("exam_date"):
        try:
            d = datetime.strptime(general["exam_date"], "%Y-%m-%d").date()
            exam_days = str((d - date.today()).days)
        except ValueError:
            pass
    sys_p = (
        "你是资深公考辅导老师，根据学生的真实学习数据写一段学习报告点评。"
        "要求：200字以内，先讲1-2个亮点（用数据），再指出1个最突出短板，"
        "最后给出具体可执行的下周建议。语言真诚不套话，不使用夸张表情。"
        "输出使用 Markdown 格式：可用 **加粗** 突出重点，建议部分用有序列表（1. 2. 3.），"
        "不要使用一级标题(#)，最多用到三级标题。"
    )
    user_p = json.dumps({
        "报告周期": rpt["periodLabel"],
        "刷题量": rpt["questions"],
        "正确率": f'{rpt["accuracy"]}%',
        "学习时长": f'{rpt["hours"]}小时',
        "连续打卡": f'{rpt["streak"]}天',
        "各模块": [f'{m["name"]}{m["accuracy"]}%' for m in rpt["modules"]],
        "距考试天数": exam_days or "未知",
    }, ensure_ascii=False)
    return ai_svc.chat_text(sys_p, user_p, temperature=0.5)


# ------------------------------------------------------------- 海报 --------
def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = (
        ["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/simhei.ttf"]
        if bold
        else ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simsun.ttc"]
    )
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _wrap(text: str, font: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    lines, cur = [], ""
    for ch in text:
        trial = cur + ch
        if ImageDraw.Draw(Image.new("RGB", (1, 1))).textlength(trial, font=font) > max_w:
            lines.append(cur)
            cur = ch
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def make_poster(period: str, privacy: dict, out_path: str) -> str:
    rpt = build_report(period)
    W, H = 900, 1400
    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)

    # 渐变背景
    top = (47, 107, 255)
    bottom = (22, 35, 63)
    for y in range(H):
        t = y / H
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))
    # 装饰圆
    draw.ellipse([W - 260, -130, W + 130, 260], fill=(70, 128, 255))
    draw.ellipse([-160, H - 260, 260, H + 160], fill=(35, 60, 120))

    f_brand = _font(34, True)
    f_title = _font(72, True)
    f_sub = _font(30)
    f_num = _font(86, True)
    f_lab = _font(28)
    f_badge = _font(32, True)

    draw.text((70, 90), "岸 · 上岸助手", font=f_brand, fill=(220, 232, 255))
    title = "学习报告" if privacy.get("current_only") else f"{rpt['periodLabel']}学习报告"
    draw.text((70, 180), title, font=f_title, fill=(255, 255, 255))
    draw.text((72, 286), time.strftime("%Y.%m.%d 生成"), font=f_sub,
              fill=(190, 208, 250))

    # 四项数据，2×2
    stats = [
        (str(rpt["questions"]), "刷题量（道）"),
        (f'{rpt["accuracy"]}%', "平均正确率"),
        (f'{rpt["hours"]}', "学习时长（小时）"),
        (f'{rpt["streak"]}天', "连续打卡"),
    ]
    x0, y0, cw, ch_h = 70, 400, 360, 280
    for i, (num, lab) in enumerate(stats):
        cx = x0 + (i % 2) * (cw + 40)
        cy = y0 + (i // 2) * (ch_h + 30)
        draw.rounded_rectangle([cx, cy, cx + cw, cy + ch_h], radius=24,
                               fill=(255, 255, 255, 255))
        draw.text((cx + 36, cy + 52), num, font=f_num, fill=(47, 107, 255))
        draw.text((cx + 38, cy + 178), lab, font=f_lab, fill=(110, 120, 140))

    # 进步徽章
    badge = "坚持学习，稳步上岸"
    if rpt["modules"]:
        best = max(rpt["modules"], key=lambda m: m["accuracy"])
        badge = f'🏅 {best["name"]}正确率 {best["accuracy"]}%'
    draw.rounded_rectangle([70, 1010, W - 70, 1090], radius=40,
                           fill=(255, 255, 255, 40), outline=(255, 255, 255, 120),
                           width=2)
    draw.text((100, 1030), badge, font=f_badge, fill=(255, 255, 255))

    # 考试倒计时
    general = storage.get_setting("general")
    if general.get("exam_date"):
        try:
            d = datetime.strptime(general["exam_date"], "%Y-%m-%d").date()
            days = (d - date.today()).days
            draw.text((70, 1150), f'距「{general.get("exam_name","考试")}」还有 '
                      f'{days} 天', font=f_sub, fill=(210, 224, 255))
        except ValueError:
            pass

    name = "匿名考生" if privacy.get("anonymous") else (
        general.get("nickname") or "考生")
    for i, line in enumerate(_wrap(f"— {name}", f_sub, W - 140)):
        draw.text((70, H - 130 + i * 40), line, font=f_sub,
                  fill=(170, 190, 235))

    img.save(out_path, "PNG")
    return out_path
