# -*- coding: utf-8 -*-
"""生成《上岸助手·用户使用手册（桌面版）》PDF（正式书面语，面向考公人群）。"""
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
OUT = os.path.join(ROOT, "上岸助手使用说明.pdf")

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
    @frame header_frame {
        -pdf-frame-content: header_content;
        left: 54pt; width: 487pt; top: 22pt; height: 32pt;
    }
    @frame footer_frame {
        -pdf-frame-content: footer_content;
        left: 54pt; width: 487pt; top: 796pt; height: 30pt;
    }
}
* { font-family: %(base)s; }
%(face)s
body { font-size: 10.5pt; color: #24292f; line-height: 1.8; }
h1 { font-size: 18pt; color: #111; margin: 16px 0 8px; }
h2 { font-size: 14.5pt; color: #17356b; border-bottom: 1.2pt solid #2f6bff;
     padding-bottom: 3px; margin: 20px 0 8px; }
h3 { font-size: 12pt; color: #111; margin: 13px 0 5px; }
p { margin: 5px 0; }
li { margin: 3px 0; }
code { background: #f2f3f7; font-size: 9.5pt; }
table { border-collapse: collapse; width: 100%%; }
th, td { border: 0.8pt solid #c9ced6; padding: 4px 8px; font-size: 9.5pt; }
th { background: #eef2fb; }
.tip { background: #eef4ff; border: 0.8pt solid #c9d8ff; border-radius: 6pt;
       padding: 8px 12px; margin: 8px 0; }
.shot { text-align: center; font-size: 9pt; color: #666; margin: 6px 0 12px; }
.shot img { width: 430pt; border: 0.8pt solid #c9ced6; }
.cover { text-align: center; }
.cover .big { font-size: 30pt; color: #17356b; margin-top: 130pt; }
.cover .mid { font-size: 17pt; color: #2f6bff; margin-top: 16pt; }
.cover .ver { font-size: 11pt; color: #666; margin-top: 14pt; }
.cover .credit { font-size: 11.5pt; color: #17356b; margin-top: 120pt; }
.muted { color: #8a919c; font-size: 9pt; }
""" % {"base": BASE_FONT, "face": FONT_FACE}


def shot(fname: str, caption: str) -> str:
    src = os.path.join(ROOT, "docs", "shots", fname).replace("\\", "/")
    return ('<div class="shot"><img src="%s"/><br/>%s</div>' % (src, caption))


import re as _re


def expand_shots(html: str) -> str:
    return _re.sub(r"\{\{SHOT:([^|}]+)\|([^}]*)\}\}",
                   lambda m: shot(m.group(1).strip(), m.group(2)), html)


def build_html() -> str:
    body = expand_shots(md_mod.markdown(BODY_MD, extensions=["extra", "nl2br"]))
    cover = """
<div class="cover">
  <div class="big">上 岸 助 手</div>
  <div class="mid">用 户 使 用 手 册</div>
  <div class="ver">（桌面版 V1.1）</div>
  <div class="ver">文档版本：V1.1<br/>发布日期：%s</div>
  <div class="credit">Power Design by 譬如朝露</div>
</div>
<pdf:nextpage />
""" % time.strftime("%Y 年 %m 月 %d 日")
    return """<html><head><meta charset="utf-8"><style>%s</style></head><body>
<div id="header_content">
  <table style="border:0;width:100%%"><tr>
    <td style="border:0;font-size:8.5pt;color:#8a919c">上岸助手 用户使用手册 V1.1</td>
    <td style="border:0;font-size:8.5pt;color:#8a919c;text-align:right">Power Design by 譬如朝露 · 第 <pdf:pagenumber/> 页</td>
  </tr></table>
</div>
%s
%s
<div id="footer_content">
  <table style="border:0"><tr>
    <td style="border:0;font-size:8.5pt;color:#8a919c">上岸助手 · 用户使用手册</td>
    <td style="border:0;font-size:8.5pt;color:#8a919c;text-align:center">Power Design by 譬如朝露</td>
    <td style="border:0;font-size:8.5pt;color:#8a919c;text-align:right">共 <pdf:pagecount/> 页</td>
  </tr></table>
</div>
</body></html>""" % (CSS, cover, body)


BODY_MD = """
## 第一章 产品概述

上岸助手是一款面向公务员录用考试备考人群的桌面学习软件，提供知识点专项练习、
错题管理、学习笔记、计划任务与学习报告等功能。软件基于粉笔题库获取练习内容，
基于人工智能模型提供练习讲解与学习点评，所有学习记录均保存于用户本机，
不依赖任何第三方服务器存储。

本手册面向软件的最终使用者，介绍软件的安装、账号连接、各功能模块的使用方法，
以及常见问题的处理方式。用户在阅读本手册后，应能够独立完成软件的全部常规操作。

## 第二章 运行环境与安装

### 2.1 运行环境

软件适用于 Windows 10 及以上版本的 64 位 Windows 操作系统。软件为绿色单文件程序，
不依赖 Python 或其他第三方运行环境，无需传统意义上的安装过程。

### 2.2 启动方法

双击程序文件「上岸助手.exe」即可启动软件。首次启动时，系统可能弹出安全提示，
请选择「仍要运行」；该提示仅因程序未经代码签名，不影响软件功能。

若双击后软件无反应，通常为系统缺少 WebView2 浏览器组件所致。
请将 Microsoft Edge 浏览器升级至最新版本后重试；如仍无法启动，请依照第七章所述方式获取技术支持。

## 第三章 粉笔账号连接

软件的练习与错题功能基于粉笔题库，使用前需连接用户的粉笔账号。连接过程已完成
全自动处理，用户仅需完成登录操作，无需手动复制任何凭证信息。

### 3.1 连接步骤

1. 启动软件，进入「设置」页面，找到「粉笔账号」栏目；
2. 点击「扫码 / 网页登录」按钮，软件将打开粉笔官方登录窗口；
3. 在登录窗口中，用户可任选微信扫码、手机验证码或账号密码方式完成登录；
4. 登录成功后，软件将自动完成凭证获取与连接验证，全程约需两秒，登录窗口随后自动关闭；
5. 页面显示「当前已连接」字样，即表示账号连接成功。

 设置页中的粉笔账号连接入口（图中顶栏可见 Power Design by 譬如朝露 标识）

### 3.2 连接异常处理

| 情况 | 处理方式 |
| --- | --- |
| 登录完成后仍显示未连接 | 关闭软件并重新打开，软件将自动重新连接；如仍未连接，请重新执行一次登录操作。 |
| 验证码无法接收 | 请改用账号密码方式登录，或先在粉笔应用内确认手机号码可正常接收短信。 |
| 使用一段时间后提示连接失效 | 粉笔登录凭证具有时效性，属正常现象。重新执行第三章 3.1 节的登录操作即可恢复。 |
| 反复尝试后仍无法连接 | 请先确认该账号可在浏览器中正常登录粉笔官方网站；确认无误后仍无法连接的，依照第七章所述方式获取技术支持。 |

## 第四章 功能使用说明

### 4.1 刷题

在「刷题」页面左侧选择知识模块与知识点，点击即可开始专项练习。答题过程中软件
自动记录用时；交卷后系统自动判定正误、展示解析，并将错题收入错题本。

做题时可以使用**排除法**辅助作答：每个选项右侧设有一个圆形斜杠图标的「排除」
按钮，点击即可将该选项划线排除，先排除明显不符的选项，再从剩余选项中挑选答案；
再次点击该按钮，或点击被排除选项的正文，即可取消排除。交卷看解析后，还可以在
练习历史中随时回看每道题的作答与解析。

{{SHOT:01_刷题.png|刷题页面：左侧为知识点列表，右侧为练习区域}}

### 4.2 错题本

「错题本」页面按模块汇总全部错题，支持按模块筛选与关键词搜索。用户可对错题进行
「复习」「已掌握」等标注：复习后系统将按照记忆规律安排下次复习日期；确认掌握后
该题移入已掌握列表。标注信息在重新同步时自动保留，不会丢失。

复习错题重新作答时，同样可以使用选项右侧的「排除」按钮先排除干扰项。点击「AI 再讲
一遍」或「分析我的错因」，小岸会结合您当次选择的选项，指出错误思路并讲解正确解法。

 错题本页面：左侧为模块筛选，右侧为错题内容与解析

### 4.3 笔记

「笔记」页面支持新建、编辑与检索学习笔记，正文支持 Markdown 语法，可通过 「导出
PDF」功能将笔记导出为 PDF 文件保存或打印。

 笔记页面

### 4.4 学习报告

「学习报告」页面按周或月汇总刷题量、正确率、学习时长与连续打卡天数，并支持 生成 AI
学习点评与分享报告海报。AI 点评功能需按第 4.5 节完成模型配置后使用。

{{SHOT:04_学习报告.png|学习报告页面}}

### 4.5 AI 模型配置

AI 讲解、点评等智能功能需要配置一个大模型服务密钥后方可使用。以 DeepSeek
服务为例，配置步骤如下：

1. 访问 platform.deepseek.com，使用手机号注册并登录；
2. 完成少量金额充值（每日刷题强度下可使用数月）；
3. 在「API keys」页面创建密钥，并复制生成的字符串；
4. 进入软件「设置 → AI 模型」，选择服务商，粘贴密钥，点击「测试连接」；
5. 测试通过后保存。其余服务商（智谱、Kimi 等）配置方法相同。

模型密钥等同于账户凭证，请勿告知他人或发布于公开场合。

未配置模型时，刷题、错题本等核心功能不受影响。

## 第五章 数据备份与迁移

软件的全部学习数据（错题、笔记、任务、配置）均保存在用户本机，更换电脑或
重新安装系统前，建议按以下步骤迁移数据：

1. 在原电脑的「设置」页面点击「导出备份」，得到备份文件；
2. 将备份文件通过移动存储或网络传输至新电脑；
3. 在新电脑上安装并启动本软件，在「设置」页面点击「导入备份」选择该文件；
4. 按照提示重启软件，全部数据即恢复完成。

建议用户每月导出一次备份，以防意外丢失。

## 第六章 常见问题处理

| 问题 | 解答 |
| --- | --- |
| 软件需要付费吗 | 软件本身免费。练习内容基于用户本人的粉笔账号，AI 功能产生的费用由所配置的模型服务商按其标准收取。 |
| 数据会上传到服务器吗 | 不会。全部数据仅保存在用户本机，软件不上传任何学习记录。 |
| 重复同步错题会重复吗 | 不会。同步仅刷新题目内容，用户标注的掌握状态与复习安排均自动保留。 |
| 可以多台电脑同时使用吗 | 可以，但各电脑数据相互独立。如需一致，使用「导出备份 / 导入备份」功能同步。 |
| 可以分享给他人使用吗 | 可以。他人使用自己的粉笔账号登录，数据互不影响。 |

## 第七章 技术支持

用户在按照本手册操作后仍无法解决问题的，请联系软件提供者获取技术支持。
联系时请说明所使用的操作系统版本，并附上问题发生时的界面截图，以便快速定位问题。

 —— 全文完 · Power Design by 譬如朝露 ——
"""


def main() -> int:
    html = build_html()
    with open(OUT, "wb") as f:
        status = pisa.CreatePDF(html, dest=f, encoding="utf-8",
                                resource_policy=ResourceAccessPolicy(
                                    extra_roots=(Path("C:/Windows/Fonts"),
                                                 Path(os.path.join(ROOT, "docs", "shots")))))
    if status.err:
        print("PDF 生成失败", file=sys.stderr)
        return 1
    print("OK", OUT, os.path.getsize(OUT), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
