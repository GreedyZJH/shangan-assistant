# -*- coding: utf-8 -*-
"""生成《上岸助手·安卓版使用说明》PDF（正式书面语，面向考公人群）。"""
import io
import os
import re
import sys
import time
from pathlib import Path

import markdown as md_mod
from xhtml2pdf import pisa
import xhtml2pdf.default as pisa_default
from xhtml2pdf.config.resources import ResourceAccessPolicy

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "上岸助手安卓版使用说明.pdf")

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
h1 { font-size: 19pt; color: #111; margin: 16px 0 8px; }
h2 { font-size: 14.5pt; color: #17356b; border-bottom: 1.2pt solid #2f6bff;
     padding-bottom: 3px; margin: 20px 0 8px; }
h3 { font-size: 12pt; color: #111; margin: 13px 0 5px; }
p { margin: 5px 0; }
li { margin: 3px 0; }
code { background: #f2f3f7; font-size: 9.5pt; }
pre { background: #f2f3f7; padding: 8px; font-size: 9.5pt; }
table { border-collapse: collapse; width: 100%%; }
th, td { border: 0.8pt solid #c9ced6; padding: 4px 8px; font-size: 9.5pt; }
th { background: #eef2fb; }
blockquote { color: #555; border-left: 3pt solid #c9ced6; padding-left: 10px;
             margin: 6px 0; }
.cover { text-align: center; }
.cover .big { font-size: 30pt; color: #17356b; margin-top: 150pt; }
.cover .mid { font-size: 17pt; color: #2f6bff; margin-top: 16pt; }
.cover .ver { font-size: 11pt; color: #666; margin-top: 40pt; }
.cover .credit { font-size: 11.5pt; color: #17356b; margin-top: 130pt; }
.toc p { margin: 4px 0; font-size: 11pt; }
.muted { color: #8a919c; font-size: 9pt; }
.tip { background: #eef4ff; border: 0.8pt solid #c9d8ff; border-radius: 6pt;
       padding: 8px 12px; margin: 8px 0; }
""" % {"base": BASE_FONT, "face": FONT_FACE}


def build_html() -> str:
    body = md_mod.markdown(BODY_MD, extensions=["extra", "nl2br"])
    cover = """
<div class="cover">
  <div class="big">上 岸 助 手</div>
  <div class="mid">安 卓 版 使 用 说 明</div>
  <div class="ver">版本 V1.2 &nbsp;·&nbsp; 适用于 Android 手机</div>
  <div class="credit">Power Design by 譬如朝露</div>
  <div class="ver">%s</div>
</div>
<pdf:nextpage />
<div class="toc">
  <h2 style="margin-top:0">目&nbsp;&nbsp;录</h2>
  %s
</div>
<pdf:nextpage />
""" % (time.strftime("%Y 年 %m 月 %d 日"), TOC_HTML)
    return """<html><head><meta charset="utf-8"><style>%s</style></head><body>
%s
%s
<div id="footer_content">
  <table style="border:0"><tr>
    <td style="border:0;font-size:8.5pt;color:#8a919c">上岸助手 · 安卓版使用说明</td>
    <td style="border:0;font-size:8.5pt;color:#8a919c;text-align:center">Power Design by 譬如朝露</td>
    <td style="border:0;font-size:8.5pt;color:#8a919c;text-align:right">第 <pdf:pagenumber/> 页 · 共 <pdf:pagecount/> 页</td>
  </tr></table>
</div>
</body></html>""" % (CSS, cover, body)


BODY_MD = """
## 一、软件简介

上岸助手是一款面向公务员考试备考的刷题与督学工具。本次交付的**安卓手机版**与电脑版界面一致、操作习惯相同，主要功能包括：知识点刷题、真题练习、错题本、学习笔记、计划任务、学习报告与 AI 私教辅导。

V1.2 版本新增了科学复习计划、薄弱点特训、字体与字号设置等多项功能，本手册均已覆盖。

V1.2 版本新增了科学复习计划、薄弱点特训、字体与字号设置等多项功能，本手册均已覆盖。

V1.2 版本新增了科学复习计划、薄弱点特训、字体与字号设置等多项功能，本手册均已覆盖。

安卓版的所有学习数据（刷题记录、错题、笔记、计划等）均**只保存在您的手机本机**，不会上传至任何第三方服务器；只有获取粉笔题目、解析以及 AI 点评时，才需要访问相应的网络服务。

## 二、安装步骤

1. 将安装文件「上岸助手-安卓版.apk」传送到手机。可以通过微信、QQ 文件传输助手、网盘或数据线发送，任选其一。
2. 在手机上点击该安装文件。若系统提示"禁止安装未知来源的应用"，请按照手机屏幕提示，允许"来自此来源的应用"进行安装（不同品牌手机的提示名称略有差异，属于正常现象）。
3. 安装完成后，在手机桌面点击「上岸助手」图标即可打开软件。

> 说明：本软件建议在 Android 8.0 及以上版本的手机中使用。首次打开如出现白屏或无法进入，请先将手机系统组件「Android System WebView」在应用商店中更新到最新版本，再重新打开软件。

## 三、首次使用：连接粉笔账号

刷题功能依赖粉笔题库，因此首次使用需要先连接您的粉笔账号。操作步骤如下：

1. 打开软件后，会出现「连接粉笔账号」的引导页面。
2. 点击「打开粉笔登录页」，软件会弹出粉笔官方登录页面。
3. 在该页面中，使用粉笔手机 App 的扫一扫功能扫码登录，也可以直接输入手机号和密码登录。
4. 登录成功后，软件会**自动完成连接**（通常在一两秒内），随后即可开始使用刷题、错题同步等功能。

如果登录成功后没有自动连接，请稍等几秒，然后点击「未自动识别？点此立即获取一次」按钮重试；如仍无法连接，可在设置中退出账号后重新登录。

## 四、日常刷题

1. 进入「刷题」页面，可以从列表选择**模块**或**知识点**开始练习，也可以选择**真题试卷**整套练习；打开刷题页时，软件会给出「今日推荐」卡片，自动定位您最薄弱的知识点，点击「特训 5 题」即可开始针对性练习。
2. 作答时点击选项即可选择；**长按选项约半秒可排除干扰项**（排除后划线置灰，再长按一次取消；手指移开自动取消，防止误触），帮助您使用排除法作答。多选题请先打开「多选模式」，如忘记打开，软件会温和提醒。
3. 在手机上开始做题后，题目会**自动铺满全屏**显示，方便阅读与作答；做题页底部有固定的操作栏，翻题、交卷随时可点；如需中途离开，可点「退出练习」安全退出（未交卷的作答不保存）。
4. 点击「交卷」时，如有漏答的题目，软件会列出具体题号并自动带您跳回检查；确认后交卷，立即显示每道题的对错、您的选择与正确答案对比、详细解析（关键句已着色），题目图片可点击放大查看。
5. 交卷后，本次练习中的错题会**自动加入错题本**，无需手动录入；同时软件会自动为您完成当日打卡。

## 五、错题本

1. 在「错题本」页面点击「同步云端错题」，可以把您在粉笔 App 中做过的错题一并导入本地错题本。
2. 错题按模块自动分类，可按模块筛选查看，也可以搜索关键字；打开错题本会**先显示列表**，点开某道题再看详情，浏览更顺手。
3. **科学复习**：软件按照艾宾浩斯记忆规律，为每道错题自动安排 1、3、7、15 天的阶梯复习；错题本顶部有「今日到期」入口，把今天该复习的逐题过完即可。复习时重新作答，答对了进入更长周期的复习安排，答错了掌握度下降并于次日再安排；长期未复习的错题掌握度会自然衰减，提醒您它正在变"生疏"。
4. 列表支持按「到期时间」或「掌握度」排序，今天到期的错题有琥珀色标记，已过复习期的显示红色；确认已掌握的错题可标记「已掌握」，之后不再打扰。
5. 每道错题都可以点击「问小岸」，由 AI 私教结合您的作答情况分析错因并给出针对性练习建议。

## 六、学习笔记

1. 在「笔记」页面可以新建笔记，支持标题、正文与标签，正文可使用 Markdown 格式排版。
2. 笔记可以关联练习中的错题，方便整理同一知识点的易错内容。
3. 点击「导出」，笔记会以文档形式（.md 文件）保存到手机的「文档（Documents）」目录中，可使用 WPS Office 等文档软件打开查看。
4. 如需要将笔记导出为 PDF 文件，请使用电脑版完成。

## 七、计划任务与学习报告

**计划任务**：在「计划」页面可以查看打卡日历、近 7 天学习时长，并设置考试名称与考试日期，软件会自动为您显示倒计时。点击「AI 生成任务」，小岸会根据您的考试信息与本周学习数据，自动安排今日任务清单；您也可以手动添加、勾选或删除任务。使用「专注」功能可以进行专注学习计时（计时器实时走字）。点击顶栏的铃铛图标，可随时查看今日学习概况：刷题进度、任务完成度与提醒时间。

**学习报告**：在「报告」页面可以查看本周、上周、本月或近 30 天的刷题量、正确率、学习时长、连续打卡天数、各模块正确率对比与近 8 周错题趋势，并可请小岸生成一段 AI 学习点评。

## 八、AI 私教：小岸

点击屏幕右下角的悬浮球即可唤出 AI 私教「小岸」。练习过程中遇到不懂的题目可以直接提问，小岸会一步步引导您判断题型、寻找规律，而不会直接报答案。

在错题本中使用「分析我的错因」时，小岸会将错因归入考公备考最常见的三类问题——**一听就懂**（听懂了讲解，自己却想不出思路）、**一做就懵**（知识点都认识，组合起来就不会用）、**边学边忘**（当时会做，过几天又忘），并分别给出补救建议。

聊天窗顶部有「清空对话」按钮，可一键删除本机保存的聊天记录；AI 回复完成而聊天窗收起时，悬浮球会亮起红点提醒您查看。

在错题本中使用「分析我的错因」时，小岸会将错因归入考公备考最常见的三类问题——**一听就懂**（听懂了讲解，自己却想不出思路）、**一做就懵**（知识点都认识，组合起来就不会用）、**边学边忘**（当时会做，过几天又忘），并分别给出补救建议。

聊天窗顶部有「清空对话」按钮，可一键删除本机保存的聊天记录；AI 回复完成而聊天窗收起时，悬浮球会亮起红点提醒您查看。

在错题本中使用「分析我的错因」时，小岸会将错因归入考公备考最常见的三类问题——**一听就懂**（听懂了讲解，自己却想不出思路）、**一做就懵**（知识点都认识，组合起来就不会用）、**边学边忘**（当时会做，过几天又忘），并分别给出补救建议。

聊天窗顶部有「清空对话」按钮，可一键删除本机保存的聊天记录；AI 回复完成而聊天窗收起时，悬浮球会亮起红点提醒您查看。在错题本中使用「分析我的错因」时，小岸会结合您当次的作答选择，指出错误思路并讲解正确解法。

使用 AI 功能前，需要先在「设置 → AI 模型」中，按照您所用 AI 服务商提供的资料，填写服务商、接口地址、访问密钥与模型名称，填写完成后点击「测试连接」，提示连接正常即可使用。

## 九、个性化设置

在「设置」页面的「字体与字号」卡片中：

- **字体**：提供微软雅黑、宋体、黑体、楷体、仿宋、等线六种字体，下拉选择后整个软件立即切换；
- **字号**：提供小、标准、大、特大四档，长时间刷题可调大字号保护视力；
- **恢复默认**：尝试后想改回来，点击「恢复默认」按钮即可。

在「护眼背景」卡片中，可为做题面板选择白、蓝、绿、红四种底色，点击立即生效，选一个看着舒服的即可。

## 十、数据备份

在「设置 → 备份与恢复」中：

- **导出备份**：软件会将全部学习数据打包为一个备份文件，保存到手机的「文档（Documents）」目录。建议定期备份，防止手机丢失或换机时数据遗失。
- **恢复备份**：选择之前导出的备份文件即可恢复；恢复完成后，请彻底关闭软件（从后台任务中划掉）并重新打开。
- 电脑版与安卓版的备份文件**通用**：可以将手机上的备份发送到电脑恢复，也可以将电脑上的备份发送到手机恢复，方便在两台设备之间迁移学习数据。

## 十一、常见问题

**问：刷题时提示"登录已过期"或无法获取题目？**
答：说明粉笔登录状态已失效。请进入「设置」，退出粉笔账号后重新扫码登录即可，本地学习数据不会丢失。

**问：AI 点评或任务生成失败？**
答：请检查「设置 → AI 模型」中的资料是否填写完整、密钥是否有效、账户余额是否充足，并点击「测试连接」确认。

**问：点击"生成海报"没有反应？**
答：学习海报的生成与保存功能目前仅在电脑版中提供，请使用电脑版操作。

**问：换手机或恢复出厂后，数据还在吗？**
答：软件数据只保存在手机本机。换机前请先在旧手机上「导出备份」，把备份文件传到新手机后「恢复备份」即可。

**问：软件打开是白屏怎么办？**
答：请先将手机系统组件「Android System WebView」更新到最新版本，然后彻底关闭软件重新打开；如仍有问题，卸载后重新安装最新安装包。

---

*本手册适用于上岸助手安卓版 V1.2。如操作界面与手册描述略有差异，请以软件实际界面为准。*

<div class="tip">数据安全提示：您的全部学习数据仅保存在手机本机。请妥善保管粉笔账号与 AI 服务密钥，不要将登录凭据透露给他人。</div>
"""

TOC_MD = """
一、软件简介
二、安装步骤
三、首次使用：连接粉笔账号
四、日常刷题
五、错题本
六、学习笔记
七、计划任务与学习报告
八、AI 私教：小岸
九、个性化设置
十、数据备份
十一、常见问题
"""
TOC_HTML = "".join("<p>%s</p>" % line.strip() for line in TOC_MD.strip().splitlines())


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
