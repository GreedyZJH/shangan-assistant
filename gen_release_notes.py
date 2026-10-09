# -*- coding: utf-8 -*-
"""生成《上岸助手 V1.2 发版说明》PDF（正式书面语，面向考公人群）。"""
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
OUT = os.path.join(ROOT, "上岸助手V1.2发版说明.pdf")

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
  <div class="mid">V1.2 发 版 说 明</div>
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
    <td style="border:0;font-size:8.5pt;color:#8a919c">上岸助手 · V1.2 发版说明</td>
    <td style="border:0;font-size:8.5pt;color:#8a919c;text-align:center">Power Design by 譬如朝露</td>
    <td style="border:0;font-size:8.5pt;color:#8a919c;text-align:right">第 <pdf:pagenumber/> 页 · 共 <pdf:pagecount/> 页</td>
  </tr></table>
</div>
</body></html>""" % (CSS, cover, body)


BODY_MD = """
## 一、版本信息

| 项目 | 内容 |
| --- | --- |
| 本次版本 | V1.2（2026 年 10 月 9 日更新） |
| 适用版本 | 桌面版（Windows）与安卓版（Android） |
| 首次发布 | 2026 年 9 月 30 日 |
| 升级性质 | 功能更新与界面优化，升级后原有学习数据全部保留 |

## 二、新增：科学复习（艾宾浩斯记忆法）

错题本现在会按照记忆科学的规律，自动为每道错题安排复习计划：

1. **阶梯复习**：新错题从第 2 天开始安排第一次复习；答对了，下次复习的间隔就
   拉长一档（依次为 1 天、3 天、7 天、15 天）；答错了，掌握度会下调，并于次日
   重新安排复习，直到真正记牢为止。
2. **今日到期**：错题本新增「今日到期复习」入口，把今天该复习的错题逐题过完
   即可，全部清零后软件会给出鼓励提示。
3. **到期颜色标记**：错题列表中，今天到期的错题以琥珀色边框标出，已过复习期
   尚未复习的错题以红色边框标出，先复习哪道一目了然。

## 三、新增：今日推荐 · 薄弱点特训

打开「刷题」页，系统会自动生成一张「今日推荐」卡片：

- 根据您的历史作答记录，自动定位**个人正确率最低、出错次数最多**的薄弱知识点；
- 点击薄弱知识点右侧的「特训 5 题」按钮，立即开始一组针对性练习；
- 若今天还有到期错题，卡片顶部会同时给出复习入口，先复习、再特训，安排一目了然。

## 四、升级：掌握度更加真实

1. **掌握度随时间衰减**：一道错题如果长期没有复习，掌握度会随天数自然下降，
   提醒您它正在变得"生疏"；完成复习后掌握度重新提升。已标记「已掌握」的题目
   不受衰减影响。
2. **列表排序**：错题列表支持按「到期时间」或「掌握度」排序，优先处理最薄弱、
   最急需复习的题目。

## 五、升级：AI 错因分析「三大坑」框架

在错题本中使用「分析我的错因」时，小岸现在会将您的错因归入考公备考中最常见的
三类问题，并给出对应的补救建议：

- **一听就懂**：听懂了讲解，自己做却想不出思路；
- **一做就懵**：知识点都认识，组合起来就不会用；
- **边学边忘**：当时会做，过几天又忘了。

每一类问题都附有针对性的改进方法，帮助您把"错过的题"真正变成"提分的题"。

## 六、新增：字体与字号设置

考虑到每位用户的使用习惯不同，设置页新增「字体与字号」卡片：

- **六种字体任选**：微软雅黑、宋体、黑体、楷体、仿宋、等线，下拉即选，
  选中后整个软件立即切换；
- **四档字号**：小、标准、大、特大，长时间刷题可调大字号保护视力；
- **一键恢复默认**：尝试后想改回来，点击「恢复默认」即可；
- 电脑与手机设置相互独立，各自保存，随时可改。

## 七、升级：做题与解析体验

围绕"做题"这一核心场景，本轮完成了多项优化：

1. **作答页更清爽**：题目行距加大，底部操作栏固定显示，翻题、交卷随时可点，
   不再随页面滚动；
2. **解析页重点更醒目**：您的选择与正确答案以徽章形式对比展示，解析中的
   关键句自动着色；题目图片支持点击放大，图形推理题看得更清楚；
3. **排除选项更顺手**：长按选项约半秒即可排除干扰项，再次长按取消；
   手指移开自动取消，防止误触；
4. **交卷更放心**：如有未作答的题目，会明确列出题号（如"第 3、7 题"），
   取消交卷时自动跳回第一道未答的题；中途也可通过「退出练习」安全离开；
5. **多选题防漏选**：单选模式下再次点选时，软件会温和提醒"这题可能是多选"，
   每题只提醒一次，不打断节奏。

## 八、优化：界面与操作细节

- 全局字号略微加大，长时间阅读眼睛更轻松；配色更柔和护眼；
- 专注计时器实时走字，时间一目了然；
- 笔记有未保存的修改时，切换会先提醒，不再丢失内容；
- 删除计划任务前需确认，防止误删；
- AI 聊天窗新增「清空对话」；AI 回复完成而聊天窗收起时，悬浮球亮红点提醒；
- 顶栏铃铛点击即可查看今日学习概况：刷题进度、任务完成度与提醒时间；
- 试卷列表切换更流畅，不再反复显示"加载中"；
- 手机端打开错题本先看到列表，点开再看详情，浏览更顺手；
- 知识点列表行距加大、进度环达标变绿、连续打卡满 7 天展示火焰天数、
  交卷得分大号渐变数字、切页淡入过渡等十余处打磨。

## 九、修复：已知问题

- 修复图形推理等题目配图在解析页不显示的问题（新错题自动带图，
  旧错题可在错题本中同步刷新获取）；
- 修复部分题目选项中出现多余横线的问题；
- 修复作答页进度条重复显示的问题；
- 顶栏与安装包的版本标识统一为 V1.2。

## 十、升级方式

**桌面版**：关闭正在运行的软件，用新的「上岸助手.exe」替换旧文件即可，
无需卸载。

**安卓版**：直接安装新的安装包覆盖旧版本即可，学习数据自动保留；如系统提示
"禁止安装未知来源的应用"，按屏幕提示允许安装即可。

<div class="tip">提示：升级前建议在「设置 → 备份与恢复」中导出一次备份，
以防万一。如升级后遇到问题，可参照使用说明手册中的"技术支持"章节联系我们。</div>

---

*本发版说明适用于上岸助手 V1.2。如操作界面与文字描述略有差异，请以软件实际界面为准。*
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
