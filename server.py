"""粉笔题库 MCP Server。

通过 stdio 对外提供 MCP 工具，读取粉笔真题库与知识点练习的
题目、正确答案与解析。鉴权使用环境变量 FENBI_COOKIE。

工具总览：
  whoami                      查看当前登录账号与考试类别
  list_course_sets            获取支持的考试类型（行测/申论/面试）
  list_labels                 获取真题库分类（国考/各省/模拟题）
  list_papers                 分页获取试卷列表，支持关键词
  get_paper                   获取单份试卷元信息
  list_keypoints              获取知识点章节树
  get_paper_questions         获取整卷题目（不含答案）
  get_paper_solutions         获取整卷题目 + 正确答案 + 完整解析
  get_keypoint_questions      按知识点出题（不含答案）
  get_keypoint_solutions      按知识点出题 + 正确答案 + 完整解析
"""

from __future__ import annotations

import json
from typing import Optional

from mcp.server.fastmcp import FastMCP

from fenbi_client import FenbiAuthError, FenbiClient, FenbiError

mcp = FastMCP("fenbi-tiku")

_client: Optional[FenbiClient] = None


def client() -> FenbiClient:
    global _client
    if _client is None:
        _client = FenbiClient()
    return _client


def dumps(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)


def run(fn, *args, **kwargs) -> str:
    """统一执行并转换错误为可读文本。"""
    try:
        return dumps(fn(*args, **kwargs))
    except FenbiAuthError as exc:
        return dumps({"error": "auth_error", "message": str(exc)})
    except FenbiError as exc:
        return dumps({"error": "fenbi_error", "message": str(exc)})
    except Exception as exc:  # noqa: BLE001
        return dumps({"error": "unexpected_error", "message": f"{type(exc).__name__}: {exc}"})


# --------------------------------------------------------------------------- #
# 工具定义
# --------------------------------------------------------------------------- #
@mcp.tool()
def whoami() -> str:
    """查看当前 Cookie 对应的登录用户信息与所选考试类别，用于确认登录态是否有效。"""
    return run(client().whoami)


@mcp.tool()
def list_course_sets() -> str:
    """获取粉笔支持的考试类型（公务员行测/申论/面试）及其接口前缀（xingce/shenlun/gwyms）。"""
    return run(client().list_course_sets)


@mcp.tool()
def list_labels(prefix: str = "xingce") -> str:
    """获取真题库的分类标签（国考、各省省考、模拟题等），返回标签ID、名称、试卷数量。

    参数:
        prefix: 科目前缀，行测为 xingce，申论为 shenlun，面试为 gwyms。
    """
    return run(client().list_labels, prefix)


@mcp.tool()
def list_papers(
    label_id: int = 1,
    page: int = 0,
    page_size: int = 20,
    keyword: Optional[str] = None,
    prefix: str = "xingce",
) -> str:
    """分页获取某分类下的试卷列表。

    参数:
        label_id: 分类标签ID，可先用 list_labels 查询；国考为 1。
        page: 页码，从 0 开始。
        page_size: 每页数量。
        keyword: 可选，按试卷名称关键词过滤（如"2025""行政执法"）。
        prefix: 科目前缀，默认 xingce。
    """
    return run(client().list_papers, prefix, label_id, page, page_size, keyword)


@mcp.tool()
def get_paper(paper_id: int, prefix: str = "xingce") -> str:
    """获取单份试卷的元信息（名称、日期、练习人数、平均分、难度等）。

    参数:
        paper_id: 试卷ID。
        prefix: 科目前缀，默认 xingce。
    """
    return run(client().get_paper, prefix, paper_id)


@mcp.tool()
def list_keypoints(prefix: str = "xingce", exam_cat_id: Optional[int] = None) -> str:
    """获取知识点章节树（政治理论、常识判断、言语、数量、判断、资料分析等），
    每个节点含题目总数、已做数量，可继续用子节点ID进行专项刷题。

    参数:
        prefix: 科目前缀，默认 xingce。
        exam_cat_id: 可选，考试类别ID（如山东A类），不传则使用账号默认。
    """
    return run(client().list_keypoints, prefix, exam_cat_id)


@mcp.tool()
def get_paper_questions(paper_id: int, prefix: str = "xingce") -> str:
    """获取一整份试卷的材料与全部题目（不含答案），适合先做题。

    参数:
        paper_id: 试卷ID。
        prefix: 科目前缀，默认 xingce。
    """

    def action():
        exercise = client().create_paper_exercise(prefix, paper_id)
        return client().get_questions(exercise["key"], prefix)

    return run(action)


@mcp.tool()
def get_paper_solutions(paper_id: int, prefix: str = "xingce") -> str:
    """获取一整份试卷的全部题目、正确答案与完整解析（会自动创建练习并交卷）。
    未提供作答时默认全选A，仅用于解锁解析，不影响读取到的正确答案。

    参数:
        paper_id: 试卷ID。
        prefix: 科目前缀，默认 xingce。
    """
    return run(client().solve_paper, prefix, paper_id, None)


@mcp.tool()
def get_keypoint_questions(
    keypoint_id: int, limit: int = 15, prefix: str = "xingce"
) -> str:
    """按知识点抽取题目（不含答案），适合专项练习。

    参数:
        keypoint_id: 知识点ID，可先用 list_keypoints 查询。
        limit: 抽取题目数量。
        prefix: 科目前缀，默认 xingce。
    """

    def action():
        exercise = client().create_keypoint_exercise(prefix, keypoint_id, limit)
        return client().get_questions(exercise["key"], prefix)

    return run(action)


@mcp.tool()
def get_keypoint_solutions(
    keypoint_id: int, limit: int = 15, prefix: str = "xingce"
) -> str:
    """按知识点抽取题目并返回正确答案与完整解析（会自动创建练习并交卷）。

    参数:
        keypoint_id: 知识点ID，可先用 list_keypoints 查询。
        limit: 抽取题目数量。
        prefix: 科目前缀，默认 xingce。
    """
    return run(client().solve_keypoint, prefix, keypoint_id, limit, None)


if __name__ == "__main__":
    mcp.run()
