/* 学习报告聚合统计（翻译 reports.py）。
 * 手机版不生成 PNG 海报（PIL 功能由电脑版提供）。 */
(function () {
  'use strict';

  function pad2(n) { return String(n).padStart(2, "0"); }
  function fmtDate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function dayStartOf(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function isoWeek(d) {
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dayNr = (t.getDay() + 6) % 7;
    t.setDate(t.getDate() - dayNr + 3);
    var ft = new Date(t.getFullYear(), 0, 4);
    var fDayNr = (ft.getDay() + 6) % 7;
    ft.setDate(ft.getDate() - fDayNr + 3);
    return 1 + Math.round((t.getTime() - ft.getTime()) / (7 * 86400000));
  }

  function rangeOf(period) {
    var today = new Date();
    var dow = (today.getDay() + 6) % 7; /* 周一=0 */
    if (period === "week") {
      var monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow);
      var tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      return [dayStartOf(monday), dayStartOf(tomorrow), "本周"];
    }
    if (period === "last_week") {
      var lastMon = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - 7);
      return [dayStartOf(lastMon), dayStartOf(new Date(lastMon.getFullYear(), lastMon.getMonth(), lastMon.getDate() + 7)), "上周"];
    }
    if (period === "month") {
      var first = new Date(today.getFullYear(), today.getMonth(), 1);
      var nxt = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return [dayStartOf(first), dayStartOf(nxt), today.getFullYear() + "年" + (today.getMonth() + 1) + "月"];
    }
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
    var end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    return [dayStartOf(start), dayStartOf(end), "近30天"];
  }

  function streak() {
    var days = {};
    DB.query("SELECT date FROM checkins").forEach(function (r) { days[r.date] = 1; });
    var n = 0;
    var d = new Date();
    while (days[fmtDate(d)]) {
      n += 1;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    }
    return n;
  }

  /* 近 8 周每周新增错题（答错题数）。 */
  function wrongTrend() {
    var today = new Date();
    var dow = (today.getDay() + 6) % 7;
    var monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow);
    var weeks = [];
    for (var i = 7; i >= 0; i--) {
      var ws = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * i);
      var we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 7);
      var row = DB.queryOne(
        "SELECT COUNT(*) c FROM question_results WHERE correct=0 AND created_at>=? AND created_at<?",
        [dayStartOf(ws), dayStartOf(we)]);
      weeks.push({ label: "W" + isoWeek(ws), value: row.c });
    }
    return weeks;
  }

  function buildReport(period) {
    var r = rangeOf(period);
    var startTs = r[0], endTs = r[1], label = r[2];

    var totals = DB.queryOne(
      "SELECT COUNT(*) total, COALESCE(SUM(correct),0) correct FROM question_results WHERE created_at>=? AND created_at<?",
      [startTs, endTs]);
    var totalQ = totals.total, correctQ = totals.correct;
    var accuracy = totalQ ? Math.round((correctQ * 100) / totalQ) : 0;

    var modules = DB.query(
      "SELECT module_name, COUNT(*) total, SUM(correct) correct FROM question_results WHERE created_at>=? AND created_at<? GROUP BY module_name",
      [startTs, endTs]).map(function (row) {
        return {
          name: row.module_name || "未分类",
          total: row.total,
          accuracy: row.total ? Math.round((row.correct * 100) / row.total) : 0,
        };
      });
    modules.sort(function (a, b) { return b.accuracy - a.accuracy; });

    var sessSec = DB.queryOne(
      "SELECT COALESCE(SUM(duration_sec),0) s FROM practice_sessions WHERE finished_at>=? AND finished_at<?",
      [startTs, endTs]).s;
    var focusSec = DB.queryOne(
      "SELECT COALESCE(SUM(duration_sec),0) s FROM focus_logs WHERE started_at>=? AND started_at<?",
      [startTs, endTs]).s;
    var hours = Math.round(((sessSec + focusSec) / 3600) * 10) / 10;

    return {
      period: period,
      periodLabel: label,
      questions: totalQ,
      correct: correctQ,
      accuracy: accuracy,
      hours: hours,
      streak: streak(),
      modules: modules,
      wrongTrend: wrongTrend(),
    };
  }

  async function aiReview(period) {
    var rpt = buildReport(period);
    var general = DB.getSetting("general");
    var examDays = "";
    if (general.exam_date) {
      var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(general.exam_date);
      if (m) {
        var ed = new Date(+m[1], +m[2] - 1, +m[3]);
        var today = new Date();
        examDays = String(Math.round(
          (ed.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000));
      }
    }
    var sysP = "你是资深公考辅导老师，根据学生的真实学习数据写一段学习报告点评。" +
      "要求：200字以内，先讲1-2个亮点（用数据），再指出1个最突出短板，" +
      "最后给出具体可执行的下周建议。语言真诚不套话，不使用夸张表情。" +
      "诊断短板时归入三类之一并点明：一听就懂（概念没吃透）、" +
      "一做就懵（知识点孤立缺串联）、边学边忘（缺乏复习巩固）。" +
      "输出使用 Markdown 格式：可用 **加粗** 突出重点，建议部分用有序列表（1. 2. 3.），" +
      "不要使用一级标题(#)，最多用到三级标题。";
    var userP = JSON.stringify({
      报告周期: rpt.periodLabel,
      刷题量: rpt.questions,
      正确率: rpt.accuracy + "%",
      学习时长: rpt.hours + "小时",
      连续打卡: rpt.streak + "天",
      各模块: rpt.modules.map(function (m2) { return m2.name + m2.accuracy + "%"; }),
      距考试天数: examDays || "未知",
    });
    return AI.chatText(sysP, userP, 0.5);
  }

  window.Reports = {
    buildReport: buildReport,
    aiReview: aiReview,
    streak: streak,
  };
})();
