# -*- coding: utf-8 -*-
"""粉笔题库服务：复用根目录 fenbi_client，提供桌面端所需的会话/解析数据。"""
from __future__ import annotations

import html as html_mod
import json
import os
import re
import sys
import threading
from typing import Any

# 引入工作区根目录的 fenbi_client.py
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import fenbi_client as fc  # noqa: E402
from fenbi_client import FenbiClient  # noqa: E402

from . import storage


_lock = threading.RLock()
_client: FenbiClient | None = None
_client_cookie: str = ""
_kp_cache: dict[str, list[dict]] = {}


# ------------------------------------------------------------- HTML 转换 ----
def _esc(s: Any) -> str:
    return html_mod.escape(str(s if s is not None else ""), quote=False)


def _blankify(s: str) -> str:
    """粉笔填空横线在数据里是连续半角空格，HTML 会折叠掉；
    转成带下边线的占位元素，显示为横线。"""
    return re.sub(" {2,}", '<span class="q-blank"></span>', s)


def _blankify_html(s: str) -> str:
    """只替换 HTML 标签之间的纯文本里的空格串，避免破坏标签属性。"""
    return re.sub(
        r">([^<]*)<",
        lambda m: ">" + _blankify(m.group(1)) + "<",
        s,
    )


def ast_to_html(node: Any) -> str:
    """粉笔富文本 AST → HTML。"""
    parts: list[str] = []

    def img_src(n: dict) -> str:
        u = ""
        for key in ("value", "url", "src"):
            v = n.get(key)
            if isinstance(v, str) and v.strip():
                u = v.strip()
                break
            if isinstance(v, dict):
                u = v.get("url") or v.get("src") or ""
                if u:
                    break
        u = str(u)
        if not u:
            return ""
        if not u.startswith("http"):
            # 相对路径（如 "xxx.png?width=560"）→ 粉笔图片服务
            u = "https://tiku.fenbi.com/api/questions/images/" + u.lstrip("/")
        return u

    def walk(n: Any) -> None:
        if isinstance(n, list):
            for item in n:
                walk(item)
            return
        if not isinstance(n, dict):
            return
        name = n.get("name")
        children = n.get("children") or []
        if name == "txt":
            parts.append(_blankify(_esc(n.get("value", ""))))
        elif name == "img":
            src = img_src(n)
            if src:
                parts.append(
                    f'<img class="q-img" src="{src}" alt="题目图片" '
                    f'onerror="this.style.display=\'none\'">'
                )
        elif name == "p":
            parts.append("<p>")
            for c in children:
                walk(c)
            parts.append("</p>")
        elif name in ("li",):
            parts.append("<li>")
            for c in children:
                walk(c)
            parts.append("</li>")
        elif name in ("ul", "ol"):
            tag = name
            parts.append(f"<{tag}>")
            for c in children:
                walk(c)
            parts.append(f"</{tag}>")
        else:  # doc 及未知节点：透传子节点
            for c in children:
                walk(c)

    walk(node)
    out = "".join(parts)
    return out if out.strip() else ""


def rich_to_html(raw: Any) -> str:
    """自动识别 HTML 字符串 / AST，统一返回 HTML。"""
    if raw is None:
        return ""
    if isinstance(raw, (dict, list)):
        return ast_to_html(raw)
    s = str(raw).strip()
    if s[:1] in ("{", "["):
        try:
            converted = ast_to_html(json.loads(s))
            if converted:
                return converted
        except (ValueError, TypeError):
            pass
    text = str(raw)
    if "<" not in text:
        return _blankify(_esc(text)).replace("\n", "<br>")
    return _blankify_html(text)


def _extract_options_html(accessories: list[dict] | None) -> list[str]:
    for acc in accessories or []:
        if isinstance(acc, dict) and acc.get("options"):
            return [rich_to_html(o) for o in acc["options"]]
    return []


# ------------------------------------------------------------- 客户端 ------
def get_client(force_new: bool = False) -> FenbiClient:
    global _client, _client_cookie
    cookie = storage.get_setting("fenbi_cookie").strip()
    if not cookie:
        raise fc.FenbiAuthError(
            "尚未连接粉笔账号，请在【设置 → 粉笔账号】中扫码 / 网页登录。"
        )
    with _lock:
        if force_new or _client is None or cookie != _client_cookie:
            if _client is not None:
                try:
                    _client.close()
                except Exception:
                    pass
            _client = FenbiClient(cookie)
            _client_cookie = cookie
        return _client


def reset_session() -> None:
    """退出登录：关闭并丢弃当前客户端与缓存（本地 Cookie 由调用方清空）。"""
    global _client, _client_cookie
    with _lock:
        if _client is not None:
            try:
                _client.close()
            except Exception:
                pass
        _client = None
        _client_cookie = ""
        _kp_cache.clear()


# ------------------------------------------------------------- 查询接口 ----
def whoami() -> dict:
    return get_client().whoami()


def list_labels(prefix: str = "xingce") -> list[dict]:
    return get_client().list_labels(prefix)


def list_papers(prefix: str, label_id: int, page: int, page_size: int,
                keyword: str = "") -> dict:
    return get_client().list_papers(prefix, label_id, page, page_size, keyword)


def keypoint_tree(prefix: str = "xingce", refresh: bool = False) -> list[dict]:
    with _lock:
        if refresh or prefix not in _kp_cache:
            _kp_cache[prefix] = get_client(force_new=refresh).list_keypoints(prefix)
        return _kp_cache[prefix]


def find_module_of_keypoint(tree: list[dict], kp_id: int) -> str:
    """根据知识点树，找到某知识点所属的一级模块名。"""
    def walk(nodes: list[dict], ancestors: list[str]) -> str:
        for n in nodes:
            path = ancestors + [n.get("name", "")]
            if str(n.get("id")) == str(kp_id):
                return ancestors[0] if ancestors else n.get("name", "")
            hit = walk(n.get("children") or [], path)
            if hit:
                return hit
        return ""
    return walk(tree, [])


def find_keypoint_name(tree: list[dict], kp_id: int) -> str:
    def walk(nodes: list[dict]) -> str:
        for n in nodes:
            if str(n.get("id")) == str(kp_id):
                return n.get("name", "")
            hit = walk(n.get("children") or [])
            if hit:
                return hit
        return ""
    return walk(tree)


# ----------------------------------------------------------- 练习会话 ------
def _build_session(ex_key: str, prefix: str) -> dict:
    client = get_client()
    meta = client._get_exercise_meta(ex_key, prefix)
    content = client._get_content_by_meta(meta, prefix)

    materials: dict[str, str] = {}
    for m in content.get("materials") or []:
        gid = m.get("globalId")
        if gid:
            materials[gid] = rich_to_html(m.get("content"))

    questions: list[dict] = []
    for q in content.get("questions") or []:
        mid = q.get("materialGlobalId") or q.get("materialId")
        questions.append({
            "globalId": q.get("globalId"),
            "id": q.get("id"),
            "type": q.get("type"),
            "contentHtml": rich_to_html(q.get("content")),
            "options": _extract_options_html(q.get("accessories")),
            "materialHtml": materials.get(mid, "") if mid else "",
            "difficulty": None,
        })

    # 批量补题目难度（失败不影响开卷练习）
    ids = [q["id"] for q in questions if q.get("id")]
    if ids:
        try:
            brief = client.get_questions_brief(prefix, ids)
            for q in questions:
                b = brief.get(str(q.get("id")))
                if b:
                    q["difficulty"] = b.get("difficulty")
        except Exception:
            pass

    return {
        "key": ex_key,
        "prefix": prefix,
        "name": content.get("name", meta.get("name", "练习")),
        "questions": questions,
    }


def start_keypoint(prefix: str, keypoint_id: int, limit: int) -> dict:
    client = get_client()
    ex = client.create_keypoint_exercise(prefix, keypoint_id, limit=limit)
    data = _build_session(ex["key"], prefix)
    data["sourceId"] = keypoint_id
    data["kind"] = "keypoint"
    return data


def start_paper(prefix: str, paper_id: int) -> dict:
    client = get_client()
    ex = client.create_paper_exercise(prefix, paper_id)
    data = _build_session(ex["key"], prefix)
    data["sourceId"] = paper_id
    data["kind"] = "paper"
    return data


def find_keypoint_id_by_name(tree: list[dict], name: str) -> int | None:
    """按考点名在知识点树中查找节点 id。同名时优先返回叶子（更具体的考点）。"""
    name = (name or "").strip()
    if not name:
        return None
    fallback = None

    def walk(nodes: list[dict]) -> int | None:
        nonlocal fallback
        for n in nodes:
            if n.get("name") == name:
                if not n.get("children"):
                    return n.get("id")
                if fallback is None:
                    fallback = n.get("id")
            hit = walk(n.get("children") or [])
            if hit is not None:
                return hit
        return None

    hit = walk(tree)
    return hit if hit is not None else fallback


def start_similar(prefix: str = "xingce", keypoint_id: int | None = None,
                  keypoint_name: str = "", module_name: str = "",
                  exclude_gid: str = "", limit: int = 2) -> dict:
    """从粉笔题库按考点出同类题。优先用 keypoint_id；否则按考点名查找；
    再降级到模块一级节点。exclude_gid 用于尽量避开当前原题。"""
    tree = keypoint_tree(prefix)
    kp_id = keypoint_id
    if kp_id is None:
        kp_id = find_keypoint_id_by_name(tree, keypoint_name)
    if kp_id is None and module_name:
        for n in tree:
            if n.get("name") == module_name:
                kp_id = n.get("id")
                break
    if kp_id is None:
        raise RuntimeError(
            "无法识别该题的考点，暂时不能自动出同类题；可在左侧手动选择考点练习。")

    client = get_client()
    data: dict | None = None
    for _ in range(2):  # 若抽到当前原题则重建一次
        ex = client.create_keypoint_exercise(prefix, int(kp_id), limit=limit)
        data = _build_session(ex["key"], prefix)
        gids = [q["globalId"] for q in data["questions"]]
        if not exclude_gid or exclude_gid not in gids:
            break
    data["sourceId"] = kp_id
    data["kind"] = "keypoint"
    return data


def submit(ex_key: str, prefix: str, answers: list[dict]) -> dict:
    """answers: [{globalId, choice:"A"(多选"A,C")}]
    返回逐题解析与我的作答结果。"""
    client = get_client()
    if answers:
        client.save_answers(ex_key, prefix, answers)
    client.submit(ex_key, prefix)
    solutions_pack = client.get_solutions(ex_key, prefix)

    mine = {a["globalId"]: str(a.get("choice", "")).upper() for a in answers}
    items: list[dict] = []
    for s in solutions_pack.get("solutions", []):
        gid = s["globalId"]
        my_ans = mine.get(gid, "")
        correct_ans = (s.get("correctAnswer") or "").upper()
        is_right = bool(my_ans) and set(my_ans.split(",")) == set(correct_ans.split(","))
        items.append({
            "globalId": gid,
            "question": s.get("question", ""),
            "options": s.get("options", []),
            "myAnswer": my_ans,
            "correctAnswer": correct_ans,
            "correctAnswerText": s.get("correctAnswerText", ""),
            "analysis": s.get("analysis", ""),
            "source": s.get("source", ""),
            "keypoints": s.get("keypoints", []),
            "correct": is_right,
            "difficulty": None,
        })

    # 批量补题目难度（失败不影响交卷）
    qids = [s.get("id") for s in solutions_pack.get("solutions", []) if s.get("id")]
    if qids:
        try:
            brief = client.get_questions_brief(prefix, qids)
            for s, it in zip(solutions_pack.get("solutions", []), items):
                b = brief.get(str(s.get("id")))
                if b:
                    it["difficulty"] = b.get("difficulty")
        except Exception:
            pass

    return {
        "name": solutions_pack.get("name", ""),
        "items": items,
        "total": len(items),
        "correctCount": sum(1 for i in items if i["correct"]),
    }


# ----------------------------------------------------------- 云端错题同步 ----
def _build_wrong_plan(prefix: str) -> tuple[list[dict], dict[int, str], dict[int, str]]:
    """拉错题树，返回：
      modules: [{"name","ids":[...]}]  顶层模块、ids 权威顺序（合计=云端错题总数）
      q2module / q2keypoint: 题目 → 模块/考点（考点取首个含该题的子节点）
    """
    tree = get_client().list_wrong_keypoint_tree(prefix, time_range=0, order=0)
    modules: list[dict] = []
    q2module: dict[int, str] = {}
    q2keypoint: dict[int, str] = {}
    for top in tree:
        name = top.get("name") or "未分类"
        if top.get("id") == -1:
            name = "其他"
        ids = list(dict.fromkeys(int(x) for x in (top.get("questionIds") or [])))
        modules.append({"name": name, "ids": ids})
        for q in ids:
            q2module[q] = name
        for child in top.get("children") or []:
            cname = child.get("name") or ""
            for q in child.get("questionIds") or []:
                q2keypoint.setdefault(int(q), cname)
    return modules, q2module, q2keypoint


def sync_wrong(prefix: str = "xingce", module: str = "",
               on_progress=None, chunk_size: int = 50) -> dict:
    """从粉笔云端同步错题并与本地合并。module 为空 → 全部；否则仅该模块。
    on_progress(done,total,phase)。每个分块落库，中途失败也保留已同步进度。"""
    modules, q2module, q2keypoint = _build_wrong_plan(prefix)
    client = get_client()

    targets: list[int] = []
    if module:
        for m in modules:
            if m["name"] == module:
                targets = list(m["ids"])
                break
        if not targets:
            raise RuntimeError(f"云端没有“{module}”模块。")
    else:
        seen: set[int] = set()
        for m in modules:
            for q in m["ids"]:
                if q not in seen:
                    seen.add(q)
                    targets.append(q)

    total = len(targets)
    new_added = 0
    content_n = 0
    skipped = 0
    if on_progress:
        on_progress(0, total, "prepare")

    for i in range(0, total, chunk_size):
        part = targets[i : i + chunk_size]
        pack = client.get_solutions_by_question_ids(
            prefix, part, sol_type=1, chunk=chunk_size)
        skipped += int(pack.get("skipped", 0) or 0)

        matmap: dict[int, str] = {}
        for mm in pack.get("materials", []) or []:
            mid = mm.get("id")
            if mid is not None:
                matmap[int(mid)] = rich_to_html(mm.get("content"))

        got = {int(s["id"]): s for s in pack.get("solutions", []) if s.get("id") is not None}
        for q in part:
            modname = q2module.get(q, "未分类")
            kpname = q2keypoint.get(q, "")
            sol = got.get(q)
            if sol is None:
                is_new = storage.upsert_cloud_wrong({
                    "global_id": str(q), "question_id": str(q), "prefix": prefix,
                    "module_name": modname, "keypoint": kpname,
                })
            else:
                mref = sol.get("materialId")
                if mref is None:
                    mref = sol.get("materialGlobalId")
                if mref is not None and str(mref).lstrip("-").isdigit() and int(mref) in matmap:
                    material_html = matmap[int(mref)]
                else:
                    material_html = rich_to_html(sol.get("material"))
                src = sol.get("shortSource")
                if not src and isinstance(sol.get("source"), str):
                    src = sol.get("source")
                is_new = storage.upsert_cloud_wrong({
                    "global_id": str(q),
                    "question_id": str(q),
                    "prefix": prefix,
                    "module_name": modname,
                    "keypoint": kpname,
                    "content_html": rich_to_html(sol.get("content")),
                    "options": _extract_options_html(sol.get("accessories")),
                    "material_html": material_html,
                    "correct_answer": fc._index_to_letter(
                        (sol.get("correctAnswer") or {}).get("choice")),
                    "analysis": rich_to_html(sol.get("solution")),
                    "source": src or "",
                })
                content_n += 1
            if is_new:
                new_added += 1
        if on_progress:
            on_progress(min(i + chunk_size, total), total, "sync")

    return {
        "total": total,
        "newAdded": new_added,
        "contentFetched": content_n,
        "skipped": skipped,
        "cloudModules": [{"name": m["name"], "count": len(m["ids"])} for m in modules],
    }
