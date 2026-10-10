# -*- coding: utf-8 -*-
"""生成《上岸助手 V1.3 发版说明》PDF（正式书面语，面向考公人群）。"""
import io
import os
import sys
import time
from pathlib import Path

import markdown as md_mod
from xhtml2pdf import pisa
import xhtml2pdf.default as pisa_default
from xhtml2pdf.config.resources import ResourceAccessPolicy

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "上岸助手V1.3发版说明.pdf")

# ---------------- 字体准备：黑体优先，等宽别名映射为可画中文的字体 ----------------
FONT_PATH = ""
for p in (r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\simkai.ttf",
          r"C:\Windows\Fonts\simfang.ttf", r"C:\Windows\Fonts\Deng.ttf"):
    if os.path.exists(p):
        try:
            with open(p, "rb"):
                pass
            FONT_PATH = p
            break
        except OSError:
            continue
if FONT_PATH:
    BASE_FONT = "CNFont"
    FONT_FACE = "@font-face { font-family: CNFont; src: url('%s'); }" % FONT_PATH.replace("\\", "/")
else:
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    except Exception:
        pass
    BASE_FONT = "STSong-Light"
    FONT_FACE = ""
for alias in ("courier new", "monospace", "mono", "monospaced", "ui-monospace"):
    pisa_default.DEFAULT_FONT[alias] = BASE_FONT

CSS = """
@page {
    size: A4;
    margin: 2.2cm 1.9cm 2.4cm 1.9cm;
    @frame footer_frame {
        -pdf-frame-content: footer_content;
        left: 54pt; width: 487pt; top: 796pt; height: 30pt;
    }
}
* { font-family: %(base)s; }
%(face)s
body { font-size: 10.5pt; color: #24292f; line-height: 1.8; }
h2 { font-size: 14.5pt; color: #17356b; border-bottom: 1.2pt solid #2f6bff;
     padding-bottom: 3px; margin: 20px 0 8px; }
h3 { font-size: 12pt; color: #111; margin: 13px 0 5px; }
p { margin: 5px 0; }
li { margin: 3px 0; }
table { border-collapse: collapse; width: 100%%; }
th, td { border: 0.8pt solid #c9ced6; padding: 4px 8px; font-size: 9.5pt; }
th { background: #eef2fb; }
.cover { text-align: center; }
.cover .big { font-size: 30pt; color: #17356b; margin-top: 150pt; }
.cover .mid { font-size: 17pt; color: #2f6bff; margin-top: 16pt; }
.cover .ver { font-size: 11pt; color: #666; margin-top: 40pt; }
.cover .credit { font-size: 11.5pt; color: #17356b; margin-top: 130pt; }
.tip { background: #eef4ff; border: 0.8pt solid #c9d8ff; border-radius: 6pt;
       padding: 8px 12px; margin: 8px 0; }
.hl { background: #fff7e6; }
""" % {"base": BASE_FONT, "face": FONT_FACE}


def build_html() -> str:
    body = md_mod.markdown(BODY_MD, extensions=["extra", "nl2br"])
    cover = """
<div class="cover">
  <div class="big">上 岸 助 手</div>
  <div class="mid">V1.3 发 版 说 明</div>
  <div class="ver">适用于桌面版与安卓版 &nbsp;·&nbsp; %s</div>
  <div class="credit">Power Design by 譬如朝露</div>
</div>
<pdf:nextpage />
""" % time.strftime("%Y 年 %m 月 %d 日")
    return """<html><head><meta charset="utf-8"><style>%s</style></head><body>
%s
%s
<div id="footer_content">
  <table style="border:0"><tr>
    <td style="border:0;font-size:8.5pt;color:#8a919c">上岸助手 · V1.3 发版说明</td>
    <td style="border:0;font-size:8.5pt;color:#8a919c;text-align:center">Power Design by 譬如朝露</td>
    <td style="border:0;font-size:8.5pt;color:#8a919c;text-align:right">第 <pdf:pagenumber/> 页 · 共 <pdf:pagecount/> 页</td>
  </tr></table>
</div>
</body></html>""" % (CSS, cover, body)


BODY_MD = """
## 一、版本信息

| 项目 | 内容 |
| --- | --- |
| 本次版本 | V1.3（2026 年 10 月 10 日更新） |
| 适用版本 | 桌面版（Windows）与安卓版（Android） |
| 首次发布 | 2026 年 9 月 30 日 |
| 升级性质 | 新增功能与体验优化，升级后原有学习数据全部保留 |

## 二、新增：模拟考模式

整卷页新增「开始模拟考」入口，帮助您在考前检验真实水平：

- 软件自动选取最新一套整卷，按行测标准时长（约 120 分钟）进入限时作答；
- 开考前有明确提示与二次确认，确认后即刻开考；
- 作答页顶部实时显示用时，营造真实考场节奏，交卷后立即出分并进入解析。

## 三、新增：错题星标

错题太多、来不及全看？现在可以为错题加星标：

- 在错题列表或详情页，点击星标按钮即可把这道题标记为"最容易再错"的重点题；
- 错题本新增「★ 星标」排序方式，加星的错题自动排到最前面；
- 考前时间紧张时，直接过一遍星标题，把最容易丢分的坑再填一遍。

## 四、新增：今日总览

打开「刷题」页，顶部会显示一条"今天要做什么"总览，包括：

- 今天还有几道到期错题待复习；
- 今日已刷题量与每日目标的完成情况；
- 今日待办任务的完成进度。

点击任意一条即可直达对应页面，不必在各个页面之间来回切换。

## 五、新增：学习周报

点击顶栏铃铛，除了原有的今日学习概况，现在还会看到"本周与上周"的对比：

- 本周刷题量比上周多了多少；
- 正确率是升了还是降了；
- 本周完成的复习题数；
- 连续打卡天数。

进步看得见，松懈有提醒。

## 六、升级：复习效果看得见

1. **复习作答计入统计**：此前复习时的答对答错不作记录，现在复习作答全部
   计入学习统计。报告页新增「复习效果」卡片，展示本周期内复习作答数、
   复习正确率与错题平均掌握度——复习有没有效果，数据说话。
2. **到期复习分批进行**：当到期错题较多时，复习改为每批 20 题的小批次进行，
   顶部显示本批进度，完成一批后可点击「再来一批」继续，告别几百题一股脑
   出现的压迫感。

## 七、升级：错题本更好找

- **按错误次数筛选**：新增"错 ≥2 次""错 ≥3 次"筛选，一键揪出反复出错的
   顽固题，重点突破；
- **星标排序**：与错题星标配合，星标题优先展示，找题更快。

## 八、升级：作答更稳

1. **多选题防漏选**：交卷前，如果多选题只选了一个选项，软件会弹窗提醒
   "这道题可能是多选"，避免因粗心丢分；
2. **试卷用时心中有数**：整卷列表中每套试卷显示"共 N 题 · 约 N 分钟"，
   开考前对用时就有预估。

## 九、优化：配置与操作细节

- 顶栏新增「Aa」快捷按钮：点击即在"小、标准、大、特大"四档字号间循环切换，
  不必进入设置页调整；
- 设置页中「护眼背景」与「字体与字号」合并为一张「视觉偏好」卡片，配置更集中；
- 顶部学习进度环与打卡火焰支持悬停查看详情：还差几题达标、已连续打卡几天；
- 笔记编辑器实时显示字数与最后更新时间。

## 十、升级方式

**桌面版**：关闭正在运行的软件，用新的「上岸助手.exe」替换旧文件即可，
无需卸载。

**安卓版**：直接安装新的安装包覆盖旧版本即可，学习数据自动保留；如系统提示
"禁止安装未知来源的应用"，按屏幕提示允许安装即可。

<div class="tip">提示：升级前建议在「设置 → 备份与恢复」中导出一次备份，
以防万一。如升级后遇到问题，可参照使用说明手册中的"技术支持"章节联系我们。</div>

---

*本发版说明适用于上岸助手 V1.3。如操作界面与文字描述略有差异，请以软件实际界面为准。*
"""


def main() -> int:
    html = build_html()
    with open(OUT, "wb") as f:
        status = pisa.CreatePDF(html, dest=f, encoding="utf-8",
                                resource_policy=ResourceAccessPolicy(
                                    extra_roots=(Path("C:/Windows/Fonts"),)))
    if status.err:
        print("PDF 生成失败", file=sys.stderr)
        return 1
    print("OK", OUT, os.path.getsize(OUT), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
