# -*- coding: utf-8 -*-
"""生成《上岸助手 V1.1 发版说明》PDF（正式书面语，面向考公人群）。"""
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
OUT = os.path.join(ROOT, "上岸助手V1.1发版说明.pdf")

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
  <div class="mid">V1.1 发 版 说 明</div>
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
    <td style="border:0;font-size:8.5pt;color:#8a919c">上岸助手 · V1.1 发版说明</td>
    <td style="border:0;font-size:8.5pt;color:#8a919c;text-align:center">Power Design by 譬如朝露</td>
    <td style="border:0;font-size:8.5pt;color:#8a919c;text-align:right">第 <pdf:pagenumber/> 页 · 共 <pdf:pagecount/> 页</td>
  </tr></table>
</div>
</body></html>""" % (CSS, cover, body)


BODY_MD = """
## 一、版本信息

| 项目 | 内容 |
| --- | --- |
| 本次版本 | V1.1 |
| 适用版本 | 桌面版（Windows）与安卓版（Android） |
| 发布日期 | %s |
| 升级性质 | 功能更新与问题修复，升级后原有学习数据全部保留 |

## 二、修复：题目图片显示问题

修复了图形推理等类型题目的配图无法显示的问题。此前部分题目（尤其是图形推理题）
的题干图片在软件中显示为空白或裂图，影响作答与回看。本次更新后，题干配图与解析
配图均可正常显示。

## 三、优化：AI 助手「小岸」的使用体验

1. **错因分析更精准**：在错题本中使用「分析我的错因」时，小岸现在能够看到您当次
   实际选择的选项，可以直接指出您的错误思路，并与正确解法进行对照讲解，
   不再出现"看不到您选了什么"的情况。
2. **手机端做题界面优化**：在手机上进入练习、查看解析或复习错题时，题目区域会
   自动铺满全屏，阅读与作答更加舒适；退出做题后自动恢复列表界面。

## 四、新增：排除选项（排除法做题）

练习做题与错题复习时，每个选项右侧新增了一个圆形斜杠图标的「排除」按钮：

- 点击该按钮即可将对应选项**划线排除**，先排除明显不符的干扰项，再从剩余选项中
  挑选答案，更贴近考场上的实际作答习惯；
- 再次点击该按钮，或点击被排除选项的正文，即可**取消排除**；
- 排除仅为作答辅助，不会影响交卷结果与统计；排除状态在前后翻题时自动保留。

## 五、升级方式

**桌面版**：关闭正在运行的软件，用新的「上岸助手.exe」替换旧文件即可，
无需卸载。

**安卓版**：直接安装新的安装包覆盖旧版本即可，学习数据自动保留；如系统提示
"禁止安装未知来源的应用"，按屏幕提示允许安装即可。

<div class="tip">提示：升级前建议在「设置 → 备份与恢复」中导出一次备份，
以防万一。如升级后遇到问题，可参照使用说明手册中的"技术支持"章节联系我们。</div>

---

*本发版说明适用于上岸助手 V1.1。如操作界面与文字描述略有差异，请以软件实际界面为准。*
""" % time.strftime("%Y 年 %m 月 %d 日")


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
