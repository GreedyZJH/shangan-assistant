"""粉笔题库 API 客户端。

封装通过逆向粉笔网页版（https://www.fenbi.com）得到的接口与调用流程，
使用登录后的 Cookie 完成鉴权。

接口分层：
  公开（无需登录）：课程集 / 分类标签 / 试卷列表
  需登录（Cookie）：知识点树 / 创建练习 / 题目内容 / 交卷 / 答案解析
"""

from __future__ import annotations

import html
import json
import os
import re
import time
from typing import Any

import httpx

TIKU_BASE = "https://tiku.fenbi.com"
LOGIN_BASE = "https://login.fenbi.com"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# 答案类型数字枚举（见于 correctAnswer.type）。
# 注意：提交作答时 answer.type 需用字符串名——选择题 "choice"、填空题 "blankFilling"。
ANSWER_CHOICE = 201
ANSWER_BLANKFILLING = 202
ANSWER_RICH_TEXT = 203
ANSWER_PURE_TEXT = 204
ANSWER_LATEX_TEXT = 206
ANSWER_KEY_ANSWER_LIST = 217


class FenbiError(RuntimeError):
    """粉笔接口业务错误。"""


class FenbiAuthError(FenbiError):
    """Cookie 缺失 / 失效。"""


# --------------------------------------------------------------------------- #
# 文本提取工具
# --------------------------------------------------------------------------- #
def _ast_to_text(node: Any) -> str:
    """把粉笔富文本 AST（{name,value,children}）递归转为纯文本。"""
    if isinstance(node, str):
        try:
            node = json.loads(node)
        except (ValueError, TypeError):
            return node
    parts: list[str] = []

    def walk(n: Any) -> None:
        if isinstance(n, dict):
            name = n.get("name")
            if name == "txt":
                parts.append(str(n.get("value", "")))
            elif name == "img":
                parts.append("[图片]")
            for child in n.get("children", []) or []:
                walk(child)
            if name in ("p", "doc") and parts and not parts[-1].endswith("\n"):
                parts.append("\n")
        elif isinstance(n, list):
            for item in n:
                walk(item)

    walk(node)
    return _clean_text("".join(parts))


def _html_to_text(raw: str) -> str:
    """把题干 / 材料里的 HTML 片段转为纯文本。"""
    if not raw:
        return ""
    s = re.sub(r"(?i)<img[^>]*>", "[图片]", raw)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?is)</p\s*>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", "", s)
    return _clean_text(html.unescape(s))


def _clean_text(s: str) -> str:
    s = s.replace("\xa0", " ")
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _rich_to_text(raw: Any) -> str:
    """自动识别 HTML / AST，返回纯文本。"""
    if raw is None:
        return ""
    if not isinstance(raw, str):
        return _ast_to_text(raw)
    stripped = raw.strip()
    if stripped[:1] in ("{", "["):
        try:
            return _ast_to_text(json.loads(stripped))
        except (ValueError, TypeError):
            pass
    return _html_to_text(raw)


def _index_to_letter(index: Any) -> str:
    """把 0 基索引（可能是 "0,2"）转成字母（"A,C"）。"""
    if index is None:
        return ""
    out: list[str] = []
    for token in str(index).strip().split(","):
        token = token.strip()
        out.append(chr(ord("A") + int(token)) if token.isdigit() else token)
    return ",".join(out)


def _extract_options(accessories: list[dict] | None) -> list[str]:
    for acc in accessories or []:
        if isinstance(acc, dict) and acc.get("options"):
            return [str(o) for o in acc["options"]]
    return []


# ---------------------------------------------------------------- #
# 富文本 → HTML（题面/解析/选项展示用，含图片与填空横线）
# ---------------------------------------------------------------- #
_IMG_PREFIX = "https://tiku.fenbi.com/api/questions/images/"


def _esc_html(s: Any) -> str:
    return html.escape(str(s if s is not None else ""), quote=False)


def _blankify(s: str) -> str:
    """填空横线：题面里的连续空白（半角空格/不间断空格 \\u00a0）转占位元素。"""
    return re.sub("[\u00a0 ]{2,}", '<span class="q-blank"></span>', s)


def _blankify_html(s: str) -> str:
    """只替换 HTML 标签之间纯文本里的空白串，避免破坏标签属性。"""
    return re.sub(
        r">([^<]*)<",
        lambda m: ">" + _blankify(m.group(1).replace("&nbsp;", "\u00a0")) + "<",
        s,
    )


def _img_src(n: dict) -> str:
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
        u = _IMG_PREFIX + u.lstrip("/")
    return u


def ast_to_html(node: Any) -> str:
    """粉笔富文本 AST → HTML。"""
    parts: list[str] = []

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
            parts.append(_blankify(_esc_html(n.get("value", ""))))
        elif name == "img":
            src = _img_src(n)
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
        elif name == "li":
            parts.append("<li>")
            for c in children:
                walk(c)
            parts.append("</li>")
        elif name in ("ul", "ol"):
            parts.append(f"<{name}>")
            for c in children:
                walk(c)
            parts.append(f"</{name}>")
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
        return _blankify(_esc_html(text)).replace("\n", "<br>")
    return _blankify_html(text)


def extract_options_html(accessories: list[dict] | None) -> list[str]:
    """选项 HTML。选项里的连续空格只是词组分隔，不转填空横线。"""
    for acc in accessories or []:
        if isinstance(acc, dict) and acc.get("options"):
            return [
                re.sub(r'<span class="q-blank"></span>', " ", rich_to_html(o))
                for o in acc["options"]
            ]
    return []


# --------------------------------------------------------------------------- #
# 客户端
# --------------------------------------------------------------------------- #
class FenbiClient:
    def __init__(self, cookie: str | None = None, timeout: float = 30.0) -> None:
        cookie = cookie or os.environ.get("FENBI_COOKIE", "")
        self.cookie = cookie.strip()
        if not self.cookie:
            raise FenbiAuthError(
                "未检测到 Cookie。请设置环境变量 FENBI_COOKIE，"
                "值为已登录粉笔的浏览器请求头中的 Cookie。"
            )
        self.http = httpx.Client(
            timeout=timeout,
            headers={
                "User-Agent": UA,
                "Cookie": self.cookie,
                "Accept": "application/json, text/plain, */*",
            },
        )

    def close(self) -> None:
        self.http.close()

    def __enter__(self) -> "FenbiClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # -- 基础请求 ---------------------------------------------------------- #
    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        try:
            resp = self.http.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise FenbiError(f"网络请求失败：{url} ({exc})") from exc
        if resp.status_code in (401, 403):
            raise FenbiAuthError(
                "鉴权失败（HTTP %d），Cookie 可能已过期，请重新获取并更新 FENBI_COOKIE。"
                % resp.status_code
            )
        return resp

    def _get_json(self, url: str, **kwargs: Any) -> Any:
        return self._request("GET", url, **kwargs).json()

    def _post_json(self, url: str, **kwargs: Any) -> Any:
        return self._request("POST", url, **kwargs).json()

    # -- 公开接口 ---------------------------------------------------------- #
    def list_course_sets(self) -> list[dict]:
        data = self._get_json(
            f"{TIKU_BASE}/api/xingce/comptroller/supportCourseSet"
            "?courseSetPrefix=xingce,shenlun,gwyms"
        )
        result = []
        for item in data.get("data", []):
            result.append(
                {
                    "courseSetId": item.get("courseSetId"),
                    "name": item.get("courseSetName"),
                    "prefix": item.get("courseSetPrefix"),
                    "courses": [
                        {"id": c.get("id"), "name": c.get("name"), "prefix": c.get("prefix")}
                        for c in item.get("comptrollerCourseVOS", [])
                    ],
                }
            )
        return result

    def list_labels(self, prefix: str = "xingce") -> list[dict]:
        data = self._get_json(f"{TIKU_BASE}/api/{prefix}/comptroller/subLabels")
        labels = data.get("value", []) if isinstance(data, dict) else data
        result = []
        for lab in labels:
            meta = lab.get("labelMeta", {}) or {}
            result.append(
                {
                    "id": lab.get("id"),
                    "name": lab.get("name"),
                    "paperCount": meta.get("paperCount"),
                    "difficulty": meta.get("difficulty"),
                }
            )
        return result

    def list_papers(
        self,
        prefix: str = "xingce",
        label_id: int = 1,
        page: int = 0,
        page_size: int = 20,
        keyword: str | None = None,
    ) -> dict:
        data = self._get_json(
            f"{TIKU_BASE}/api/{prefix}/comptroller/papers"
            f"?toPage={page}&pageSize={page_size}&labelId={label_id}"
        )
        papers = []
        for p in data.get("list", []):
            meta = p.get("paperMeta", {}) or {}
            papers.append(
                {
                    "id": p.get("id"),
                    "name": p.get("name"),
                    "date": p.get("date"),
                    "exerciseCount": meta.get("exerciseCount"),
                    "difficulty": meta.get("difficulty"),
                    "lockStatus": p.get("lockStatus"),
                }
            )
        if keyword:
            kw = keyword.strip()
            papers = [p for p in papers if kw in (p["name"] or "")]
        return {"pageInfo": data.get("pageInfo", {}), "papers": papers}

    def get_paper(self, prefix: str, paper_id: int) -> dict:
        data = self._get_json(f"{TIKU_BASE}/api/{prefix}/papers/{paper_id}")
        meta = data.get("paperMeta", {}) or {}
        return {
            "id": data.get("id"),
            "name": data.get("name"),
            "date": data.get("date"),
            "exerciseCount": meta.get("exerciseCount"),
            "averageScore": meta.get("averageScore"),
            "difficulty": meta.get("difficulty"),
            "checkId": data.get("encodeCheckInfo"),
        }

    # -- 知识点 ------------------------------------------------------------ #
    def list_keypoints(self, prefix: str = "xingce", exam_cat_id: int | None = None) -> list[dict]:
        url = f"{TIKU_BASE}/api/{prefix}/categories/home?filter=keypoint"
        if exam_cat_id:
            url += f"&examcatid={exam_cat_id}"
        data = self._get_json(url)
        nodes = (data.get("data") or {}).get("baseKeypointVOS", [])

        def convert(node: dict) -> dict:
            children = node.get("children")
            return {
                "id": node.get("id"),
                "name": node.get("name"),
                "count": node.get("count"),
                "answerCount": node.get("answerCount"),
                "lockStatus": node.get("lockStatus"),
                "children": [convert(c) for c in children] if isinstance(children, list) else [],
            }

        return [convert(n) for n in nodes]

    # -- 练习生命周期 ------------------------------------------------------ #
    def create_paper_exercise(self, prefix: str, paper_id: int) -> dict:
        return self._create_exercise(
            prefix, {"type": 1, "paperId": paper_id, "exerciseTimeMode": 2}
        )

    def create_keypoint_exercise(
        self, prefix: str, keypoint_id: int, limit: int = 15
    ) -> dict:
        return self._create_exercise(
            prefix,
            {
                "type": 3,
                "keypointId": keypoint_id,
                "limit": limit,
                "exerciseTimeMode": 2,
            },
        )

    def _create_exercise(self, prefix: str, fields: dict) -> dict:
        body = "&".join(f"{k}={v}" for k, v in fields.items())
        data = self._post_json(
            f"{TIKU_BASE}/api/{prefix}/exercises",
            content=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        return {
            "key": data.get("key"),
            "id": data.get("id"),
            "name": (data.get("sheet") or {}).get("name"),
            "questionCount": (data.get("sheet") or {}).get("questionCount"),
        }

    def _get_exercise_meta(self, key: str, prefix: str) -> dict:
        data = self._get_json(
            f"{TIKU_BASE}/combine/exercise/getExercise"
            f"?format=json&key={key}&routecs={prefix}"
        )
        return data.get("data", {})

    def _get_content_by_meta(self, meta: dict, prefix: str) -> dict:
        urls = (meta.get("staticUrl") or {}).get("urls") or []
        if not urls:
            raise FenbiError("练习元信息中缺少 staticUrl。")
        url = urls[0] + f"&routecs={prefix}"
        sheet_type = meta.get("sheetType")
        if sheet_type is not None:
            url += f"&type={sheet_type}"
        return self._get_json(url)

    def get_questions(self, key: str, prefix: str) -> dict:
        """获取练习的材料与题目（不含答案）。"""
        meta = self._get_exercise_meta(key, prefix)
        content = self._get_content_by_meta(meta, prefix)
        return {
            "name": content.get("name", meta.get("name")),
            "materials": self._format_materials(content.get("materials")),
            "questions": [self._format_question(q) for q in content.get("questions", [])],
        }

    # -- 作答 / 交卷 / 解析 ------------------------------------------------- #
    def save_answers(self, key: str, prefix: str, answers: list[dict]) -> bool:
        """answers: [{"globalId","choice"(0基索引或字母，如"0"/"A")}]
        或 [{"globalId","blanks":[...]}]"""
        payload = []
        for ans in answers:
            if "choice" in ans:
                choice = str(ans["choice"]).strip()
                if choice.isdigit():  # 统一转为字母
                    choice = _index_to_letter(choice)
                answer = {"choice": choice, "type": "choice"}
            elif "blanks" in ans:
                answer = {"blanks": ans["blanks"], "type": "blankFilling"}
            else:
                continue
            payload.append(
                {
                    "userAnswer": {
                        "key": ans["globalId"],
                        "time": int(ans.get("time", 0)),
                        "answer": answer,
                    },
                    "answered": True,
                }
            )
        if not payload:
            return False
        data = self._post_json(
            f"{TIKU_BASE}/combine/exercise/incrUpdate"
            f"?key={key}&routecs={prefix}",
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        return bool(data.get("data"))

    def submit(self, key: str, prefix: str) -> bool:
        data = self._post_json(
            f"{TIKU_BASE}/combine/exercise/submit"
            f"?key={key}&routecs={prefix}"
        )
        return bool(data.get("data"))

    def get_solutions(self, key: str, prefix: str) -> dict:
        """交卷后获取材料、题目、正确答案与完整解析。"""
        data = self._get_json(
            f"{TIKU_BASE}/combine/exercise/getSolution"
            f"?format=json&key={key}&routecs={prefix}"
        )
        sol_meta = data.get("data", {})
        urls = (sol_meta.get("staticUrl") or {}).get("urls") or []
        if not urls:
            raise FenbiError("解析元信息中缺少 staticUrl，练习可能尚未交卷。")
        sol_url = urls[0] + f"&routecs={prefix}"
        if sol_meta.get("sheetType") is not None:
            sol_url += f"&type={sol_meta['sheetType']}"
        # 解析静态内容可能在交卷后有短暂生成延迟，做短轮询。
        content = {}
        for _ in range(8):
            content = self._get_json(sol_url)
            if content.get("solutions"):
                break
            time.sleep(1)
        user_answers = sol_meta.get("userAnswers", {})
        solutions = [self._format_solution(s, user_answers) for s in content.get("solutions", [])]
        return {
            "name": content.get("name", sol_meta.get("name")),
            "materials": self._format_materials(content.get("materials")),
            "solutions": solutions,
        }

    def solve_paper(self, prefix: str, paper_id: int, answers: list[dict] | None = None) -> dict:
        """一站式：创建整卷练习 -> (作答) -> 交卷 -> 返回完整解析。"""
        exercise = self.create_paper_exercise(prefix, paper_id)
        return self._finish_and_solve(prefix, exercise["key"], answers)

    def solve_keypoint(
        self,
        prefix: str,
        keypoint_id: int,
        limit: int = 15,
        answers: list[dict] | None = None,
    ) -> dict:
        """一站式：创建知识点练习 -> (作答) -> 交卷 -> 返回完整解析。"""
        exercise = self.create_keypoint_exercise(prefix, keypoint_id, limit)
        return self._finish_and_solve(prefix, exercise["key"], answers)

    def _finish_and_solve(self, prefix: str, key: str, answers: list[dict] | None) -> dict:
        question_pack = self.get_questions(key, prefix)
        if answers is None:
            answers = [
                {"globalId": q["globalId"], "choice": "0"}
                for q in question_pack["questions"]
            ]
        if answers:
            try:
                self.save_answers(key, prefix, answers)
            except FenbiError:
                pass
        self.submit(key, prefix)
        pack = self.get_solutions(key, prefix)
        pack["exerciseKey"] = key
        return pack

    # -- 用户信息 ---------------------------------------------------------- #
    def whoami(self) -> dict:
        out: dict[str, Any] = {}
        try:
            info = self._get_json(f"{LOGIN_BASE}/api/users/info")
            data = info.get("data") if isinstance(info.get("data"), dict) else info
            out["user"] = {
                "id": data.get("userId") or data.get("id"),
                "name": data.get("nickname") or data.get("name"),
                "phone": data.get("phone"),
            }
        except FenbiError:
            out["user"] = None
        try:
            cat = self._get_json(f"{TIKU_BASE}/activity/userexamcategory/getCurrent")
            data = cat.get("data") or {}
            out["examCategory"] = {
                "id": data.get("examCategoryId"),
                "name": data.get("name"),
                "path": data.get("path"),
                "currentCourse": data.get("currentCourse"),
            }
        except FenbiError:
            out["examCategory"] = None
        return out

    # -- 云端错题 ---------------------------------------------------------- #
    def list_wrong_keypoint_tree(
        self, prefix: str = "xingce", time_range: int = 0, order: int = 0
    ) -> list[dict]:
        """错题知识点树：顶层节点=模块，其 questionIds 为该模块全部错题（顺序权威，
        各模块合计即网页「错题」总数）。子节点为细分考点，questionIds 可能交叉重复。
        注意 time_range=-1 时必须同时给 startDate/endDate，否则返回空。"""
        url = (
            f"{TIKU_BASE}/api/{prefix}/errors/keypoint-tree"
            f"?timeRange={time_range}&order={order}"
        )
        data = self._get_json(url)
        return data if isinstance(data, list) else []

    def get_solutions_by_question_ids(
        self,
        prefix: str,
        question_ids: list,
        sol_type: int = 1,
        chunk: int = 50,
    ) -> dict:
        """按题目 ID 直接批量取题面 + 正确答案 + 解析（无需创建练习）。
        sol_type=1 为实测可用类型。返回 {"materials": [], "solutions": [], "skipped": n}。
        整批 403（含个别无权题）时自动二分，抢救可访问题目，跳过的题计入 skipped。"""
        ids: list[int] = []
        for x in question_ids:
            try:
                ids.append(int(x))
            except (TypeError, ValueError):
                pass
        materials: list[dict] = []
        solutions: list[dict] = []
        skipped = 0

        def fetch_part(part: list[int]) -> tuple[str, Any]:
            qs = ",".join(str(i) for i in part)
            url = (
                f"{TIKU_BASE}/api/{prefix}/universal/auth/solutions"
                f"?type={sol_type}&questionIds={qs}"
            )
            try:
                resp = self.http.request("GET", url)
            except httpx.HTTPError as exc:
                raise FenbiError(f"网络请求失败：{url} ({exc})") from exc
            if resp.status_code == 401:
                raise FenbiAuthError("Cookie 已过期，请重新获取并更新。")
            if resp.status_code == 403:
                return "forbidden", None
            if resp.status_code != 200:
                return "error", resp.status_code
            try:
                return "ok", resp.json()
            except ValueError:
                return "error", "bad-json"

        def handle(part: list[int]) -> None:
            nonlocal skipped
            status, payload = fetch_part(part)
            if status == "ok":
                materials.extend(payload.get("materials", []) or [])
                solutions.extend(payload.get("solutions", []) or [])
                return
            if status == "forbidden" and len(part) > 1:
                mid = len(part) // 2
                handle(part[:mid])
                handle(part[mid:])
                return
            if status == "forbidden":
                skipped += 1  # 单题无权查看，跳过

        for i in range(0, len(ids), chunk):
            handle(ids[i : i + chunk])
        return {"materials": materials, "solutions": solutions, "skipped": skipped}

    def get_questions_brief(
        self,
        prefix: str,
        question_ids: list,
        chunk: int = 50,
    ) -> dict:
        """按数字题 ID 批量取题目简要信息（难度 difficulty、content、correctAnswer 等）。
        返回 {str(题id): 原始dict}；单批失败自动跳过，不影响其余批次。"""
        out: dict = {}
        ids: list[int] = []
        for x in question_ids:
            try:
                ids.append(int(x))
            except (TypeError, ValueError):
                pass
        for i in range(0, len(ids), chunk):
            part = ids[i : i + chunk]
            qs = ",".join(str(x) for x in part)
            url = f"{TIKU_BASE}/api/{prefix}/questions?ids={qs}"
            try:
                resp = self.http.request("GET", url)
                if resp.status_code != 200:
                    continue
                data = resp.json()
            except (httpx.HTTPError, ValueError):
                continue
            if isinstance(data, list):
                for q in data:
                    if isinstance(q, dict) and q.get("id") is not None:
                        out[str(q["id"])] = q
        return out

    # -- 格式化 ------------------------------------------------------------ #
    def _format_materials(self, materials: list[dict] | None) -> list[dict]:
        return [
            {
                "id": m.get("id"),
                "globalId": m.get("globalId"),
                "content": _rich_to_text(m.get("content")),
                "contentHtml": rich_to_html(m.get("content")),
            }
            for m in materials or []
        ]

    def _format_question(self, q: dict) -> dict:
        return {
            "id": q.get("id"),
            "globalId": q.get("globalId"),
            "type": q.get("type"),
            "question": _rich_to_text(q.get("content")),
            "options": _extract_options(q.get("accessories")),
        }

    def _format_solution(self, sol: dict, user_answers: dict) -> dict:
        options = _extract_options(sol.get("accessories"))
        correct = sol.get("correctAnswer") or {}
        choice_index = correct.get("choice")
        letter = _index_to_letter(choice_index)
        correct_text = ""
        if letter and options:
            idxs = [int(t) for t in str(choice_index).split(",") if t.strip().isdigit()]
            correct_text = "；".join(
                f"{_index_to_letter(i)}. {options[i]}" for i in idxs if i < len(options)
            )
        my = user_answers.get(sol.get("globalId"), {})
        return {
            "id": sol.get("id"),
            "globalId": sol.get("globalId"),
            "type": sol.get("type"),
            "materialId": sol.get("materialId"),
            "materialGlobalId": sol.get("materialGlobalId"),
            "question": _rich_to_text(sol.get("content")),
            "contentHtml": rich_to_html(sol.get("content")),
            "options": options,
            "optionsHtml": extract_options_html(sol.get("accessories")),
            "correctAnswer": letter,
            "correctAnswerIndex": choice_index,
            "correctAnswerText": correct_text,
            "analysis": _rich_to_text(sol.get("solution")),
            "analysisHtml": rich_to_html(sol.get("solution")),
            "source": sol.get("source"),
            "keypoints": [k.get("name") for k in sol.get("keypoints", [])],
            "myStatus": my.get("status"),
        }
