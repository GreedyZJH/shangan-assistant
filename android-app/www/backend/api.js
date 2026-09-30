/* 安卓版 API 桥（翻译 desktop/backend/api.py）。
 * 由 bridge.js 挂载为 window.pywebview.api.*，前端 app.js 零改动复用。
 * 平台特化：登录走原生 Activity（AndroidBridge）、导出写 Documents、
 * 海报生成不可用（提示用电脑版）。 */
(function () {
  'use strict';

  /* ------------------------------------------------------- 基础工具 ---- */
  function err(msg) { return new Error(msg); }
  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function textToHtml(text) {
    return escHtml(text).replace(/ {2,}/g, '<span class="q-blank"></span>')
      .replace(/\n/g, "<br>");
  }
  function emit(ev, payload) {
    try { if (window.__appEvent) window.__appEvent(ev, payload); } catch (e) {}
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function fmtDate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function midnight(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function msToDateLabel(ms) {
    if (!ms) return "";
    var d = new Date(ms);
    var today = new Date();
    var tmr = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    if (fmtDate(d) === fmtDate(today)) return "今天复习";
    if (fmtDate(d) === fmtDate(tmr)) return "明天复习";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日复习";
  }
  function parseCookieStr(s) {
    var out = {};
    String(s || "").split(";").forEach(function (chunk) {
      chunk = chunk.trim();
      var i = chunk.indexOf("=");
      if (!chunk || i < 0) return;
      out[chunk.slice(0, i).trim()] = chunk.slice(i + 1).trim();
    });
    return out;
  }
  var COOKIE_ORDER = ["device_id", "sid", "persistent", "sess", "userid"];
  function orderedCookieStr(pairs) {
    var ordered = {};
    COOKIE_ORDER.forEach(function (k) { if (k in pairs) ordered[k] = pairs[k]; });
    Object.keys(pairs).forEach(function (k) { if (!(k in ordered)) ordered[k] = pairs[k]; });
    return Object.keys(ordered).map(function (k) { return k + "=" + ordered[k]; }).join("; ");
  }
  function setEq(a, b) {
    var sa = {}, sb = {};
    a.forEach(function (x) { if (x) sa[x] = 1; });
    b.forEach(function (x) { if (x) sb[x] = 1; });
    var ka = Object.keys(sa), kb = Object.keys(sb);
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return !!sb[k]; });
  }
  function NB() { return window.AndroidBridge || null; }

  /* ------------------------------------------------------- 初始化 ---- */
  function streak() {
    var days = {};
    DB.query("SELECT date FROM checkins").forEach(function (r) { days[r.date] = 1; });
    var n = 0, d = new Date();
    while (days[fmtDate(d)]) {
      n += 1;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    }
    return n;
  }

  async function app_init() {
    var model = DB.getSetting("model");
    var general = DB.getSetting("general");
    var privacy = DB.getSetting("privacy");
    var cookieSet = !!String(DB.getSetting("fenbi_cookie") || "").trim();
    var wrongActive = DB.queryOne(
      "SELECT COUNT(*) c FROM wrong_questions WHERE status='active'").c;
    var notesN = DB.queryOne("SELECT COUNT(*) c FROM notes").c;
    var todayTasks = DB.queryOne(
      "SELECT COUNT(*) c FROM tasks WHERE date=? AND status='done'",
      [DB.todayStr()]).c;
    var dayStart = midnight(new Date());
    var todayQuestions = DB.queryOne(
      "SELECT COUNT(*) c FROM question_results WHERE created_at>=?", [dayStart]).c;
    return {
      model: Object.assign({}, model, { api_key_set: !!model.api_key }),
      general: general,
      privacy: privacy,
      cookieSet: cookieSet,
      counts: {
        wrongActive: wrongActive, notes: notesN,
        todayTasksDone: todayTasks, todayQuestions: todayQuestions,
        streak: streak(),
      },
    };
  }

  /* ------------------------------------------------------- 粉笔 ---- */
  function fenbi_whoami() { return Fenbi.whoami(); }
  function fenbi_keypoints(refresh) { return Fenbi.keypointTree("xingce", refresh); }
  function fenbi_labels() { return Fenbi.listLabels("xingce"); }
  function fenbi_papers(labelId, page, pageSize, keyword) {
    return Fenbi.listPapers("xingce", labelId, page || 0, pageSize || 20, keyword || "");
  }

  /* ------------------------------------------------------- 练习 ---- */
  async function practice_start_keypoint(keypointId, limit) {
    var data = await Fenbi.startKeypoint("xingce", keypointId, limit);
    var tree = await Fenbi.keypointTree("xingce");
    var mod = Fenbi.findModuleOfKeypoint(tree, keypointId);
    var sid = DB.createSession("keypoint", keypointId, data.name, "xingce",
      data.key, data.questions.length);
    return Object.assign({}, data, { sessionId: sid, module: mod });
  }

  async function practice_start_paper(paperId) {
    var data = await Fenbi.startPaper("xingce", paperId);
    var sid = DB.createSession("paper", paperId, data.name, "xingce",
      data.key, data.questions.length);
    return Object.assign({}, data, { sessionId: sid, module: "" });
  }

  async function practice_similar(payload) {
    payload = payload || {};
    var limit = Math.max(1, Math.min(10, parseInt(payload.limit, 10) || 2));
    var data = await Fenbi.startSimilar({
      prefix: "xingce",
      keypointId: payload.keypointId || null,
      keypointName: payload.keypointName || "",
      moduleName: payload.moduleName || "",
      excludeGid: String(payload.excludeGid || ""),
      limit: limit,
    });
    var sid = DB.createSession("similar", data.sourceId, data.name, "xingce",
      data.key, data.questions.length);
    var tree = await Fenbi.keypointTree("xingce");
    var mod = Fenbi.findModuleOfKeypoint(tree, parseInt(data.sourceId, 10));
    return Object.assign({}, data, { sessionId: sid, module: mod });
  }

  function mapNamesToModules(tree) {
    var out = {};
    (function walk(nodes, module) {
      (nodes || []).forEach(function (n) {
        var mod = module || n.name || "";
        out[n.name || ""] = mod;
        walk(n.children || [], mod);
      });
    })(tree, "");
    return out;
  }

  async function practice_submit(payload) {
    var sessionId = payload.sessionId;
    var key = payload.key;
    var prefix = payload.prefix || "xingce";
    var answers = payload.answers || [];
    var durationSec = payload.durationSec || 0;
    var moduleGiven = payload.module || "";

    var pack = await Fenbi.submitAndSolve(key, prefix, answers);

    var mine = {};
    answers.forEach(function (a) {
      mine[a.globalId] = String(a.choice || "").toUpperCase();
    });
    var items = (pack.solutions || []).map(function (s) {
      var my = mine[s.globalId] || "";
      var ca = String(s.correctAnswer || "").toUpperCase();
      return {
        globalId: s.globalId,
        question: s.question || "",
        options: s.options || [],
        myAnswer: my,
        correctAnswer: ca,
        correctAnswerText: s.correctAnswerText || "",
        analysis: s.analysis || "",
        source: s.source || "",
        keypoints: s.keypoints || [],
        correct: !!my && setEq(my.split(","), ca.split(",")),
        difficulty: null,
      };
    });
    /* 批量补题目难度（失败不影响交卷） */
    var qids = (pack.solutions || []).map(function (s) { return s.id; })
      .filter(function (x) { return x !== undefined && x !== null; });
    if (qids.length) {
      try {
        var brief = await Fenbi.questionsBrief(prefix, qids);
        items.forEach(function (it, i2) {
          var b = brief[String(pack.solutions[i2].id)];
          it.difficulty = b ? b.difficulty : null;
        });
      } catch (e1) {}
    }
    var result = {
      name: pack.name || "",
      items: items,
      total: items.length,
      correctCount: items.filter(function (i) { return i.correct; }).length,
    };

    var nameMap = {};
    try { nameMap = mapNamesToModules(await Fenbi.keypointTree(prefix)); } catch (e) {}
    items.forEach(function (item) {
      var kp = item.keypoints.length ? item.keypoints[0] : "";
      var mod = moduleGiven || nameMap[kp] || "未分类";
      DB.addQuestionResult(sessionId, item.globalId, mod, kp, item.correct);
      /* 本地累计作答统计（含本场），供解析区展示"个人正确率" */
      var row = DB.queryOne(
        "SELECT COUNT(*) n, COALESCE(SUM(correct),0) c FROM question_results WHERE global_id=?",
        [String(item.globalId)]);
      item.localAttempts = row ? row.n : 0;
      item.localCorrect = row ? row.c : 0;
      if (!item.correct) {
        DB.upsertWrong({
          global_id: String(item.globalId), question_id: "", prefix: prefix,
          module_name: mod, keypoint: kp,
          content_html: textToHtml(item.question), options: item.options,
          my_answer: item.myAnswer, correct_answer: item.correctAnswer,
          analysis: item.analysis, source: item.source || "",
        });
      }
    });
    DB.finishSession(sessionId, result.correctCount, durationSec);
    /* 完成练习即视为打卡 */
    DB.insert("INSERT OR IGNORE INTO checkins(date,created_at) VALUES(?,?)",
      [DB.todayStr(), DB.nowMs()]);
    return result;
  }

  /* --------------------------------------------------- 练习历史 ---- */
  function practice_history(limit) {
    limit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 200));
    return DB.query(
      "SELECT id, kind, source_name, total_count, correct_count," +
      " duration_sec, finished_at FROM practice_sessions" +
      " WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT ?", [limit]);
  }

  async function practice_history_detail(sessionId) {
    var sess = DB.queryOne("SELECT * FROM practice_sessions WHERE id=?",
      [parseInt(sessionId, 10)]);
    if (!sess) throw err("练习记录不存在。");
    var prefix = sess.prefix || "xingce";

    /* 1) 本场每题的对错（按首次出现顺序） */
    var items = [], correctMap = {};
    DB.query("SELECT global_id, correct FROM question_results WHERE session_id=? ORDER BY id",
      [sess.id]).forEach(function (r) {
        var gid = String(r.global_id);
        if (gid in correctMap) return;
        correctMap[gid] = r.correct ? 1 : 0;
        items.push({ globalId: gid });
      });
    if (!items.length) throw err("本地作答明细缺失，无法回看这场练习。");

    /* 2) 远端内容：主路径为交卷解析包（getSolution 交卷后仍可访问），
       原卷内容（getExercise）可能过期，仅作补充；拿不到时降级本地。 */
    var qmap = {}, brief = {}, solByKey = {}, matMap = {}, sols = [];
    try {
      if (sess.ex_key) {
        try {
          var solPack = await Fenbi.getSolutions(sess.ex_key, prefix);
          (solPack.materials || []).forEach(function (m) {
            if (m.globalId) matMap[String(m.globalId)] = m.content || "";
          });
          sols = solPack.solutions || [];
          sols.forEach(function (s) {
            [s.globalId, s.id].forEach(function (k) {
              if (k !== undefined && k !== null) solByKey[String(k)] = s;
            });
          });
        } catch (e2) { sols = []; }
        try {
          var meta = await Fenbi.getExerciseMeta(sess.ex_key, prefix);
          var content = await Fenbi.getContentByMeta(meta, prefix);
          (content.questions || []).forEach(function (q) {
            if (q.globalId) qmap[String(q.globalId)] = q;
          });
        } catch (e3) { qmap = {}; }
        var ids = sols.map(function (s) { return s.id; })
          .filter(function (x) { return x !== undefined && x !== null; })
          .concat(Object.keys(qmap).map(function (k) { return qmap[k].id; })
            .filter(function (x) { return x !== undefined && x !== null; }));
        if (ids.length) {
          try { brief = await Fenbi.questionsBrief(prefix, ids); } catch (e4) {}
        }
      }
    } catch (e) { /* Cookie 过期 / 原卷过期：降级为仅展示本地记录 */ }

    var outItems = items.map(function (it) {
      var gid = it.globalId;
      var q = qmap[gid] || {};
      var s = solByKey[gid] || {};
      var b = brief[String(s.id)] || brief[String(q.id)] || {};
      var matId = q.materialGlobalId || q.materialId;
      var base = {
        globalId: gid,
        myAnswer: "",
        correct: !!correctMap[gid],
        hist: true,
        difficulty: b.difficulty !== undefined ? b.difficulty : null,
        material: matId ? (matMap[String(matId)] || "") : "",
      };
      try {
        var row = DB.queryOne(
          "SELECT COUNT(*) n, COALESCE(SUM(correct),0) c FROM question_results WHERE global_id=?",
          [gid]);
        base.localAttempts = row ? row.n : 0;
        base.localCorrect = row ? row.c : 0;
      } catch (e4) { base.localAttempts = 0; base.localCorrect = 0; }

      if (s.globalId !== undefined || s.question) {
        return Object.assign({}, base, {
          question: s.question || "",
          options: s.options || [],
          correctAnswer: s.correctAnswer || "",
          correctAnswerText: s.correctAnswerText || "",
          analysis: s.analysis || "",
          source: s.source || "",
          keypoints: s.keypoints || [],
        });
      }
      var src = Object.keys(q).length ? q : b;
      if (Object.keys(src).length) {
        var opts = [], letter = "";
        try {
          opts = Fenbi.extractOptionsText(src.accessories);
          letter = Fenbi.indexToLetter((src.correctAnswer || {}).choice);
        } catch (e5) {}
        return Object.assign({}, base, {
          question: Fenbi.richToText(src.content) || "（原练习内容已过期，无法回看本题）",
          options: opts,
          correctAnswer: letter,
          correctAnswerText: "",
          analysis: "（该题解析内容受限，暂无法回看）",
          source: src.shortSource || "",
          keypoints: [],
        });
      }
      return Object.assign({}, base, {
        question: "（原练习内容已过期，无法回看本题）",
        options: [],
        correctAnswer: "",
        correctAnswerText: "",
        analysis: "",
        source: "",
        keypoints: [],
      });
    });

    return {
      hist: true,
      sessionId: sess.id,
      name: sess.source_name || "练习记录",
      kind: sess.kind || "keypoint",
      finishedAt: sess.finished_at,
      durationSec: sess.duration_sec || 0,
      items: outItems,
      total: outItems.length,
      correctCount: outItems.filter(function (x) { return x.correct; }).length,
    };
  }

  /* ------------------------------------------------------- 错题 ---- */
  function wrong_list(query, status, module) {
    var sql = "SELECT * FROM wrong_questions WHERE status=?";
    var params = [status || "active"];
    if (module) { sql += " AND module_name=?"; params.push(module); }
    if (query) {
      sql += " AND (content_html LIKE ? OR keypoint LIKE ?)";
      params.push("%" + query + "%", "%" + query + "%");
    }
    sql += " ORDER BY COALESCE(next_review_at,0) ASC, id ASC";
    return DB.query(sql, params).map(function (r) {
      var d = Object.assign({}, r);
      try { d.options = JSON.parse(d.options_json || "[]"); }
      catch (e) { d.options = []; }
      d.nextReviewLabel = msToDateLabel(d.next_review_at);
      delete d.options_json;
      return d;
    });
  }

  function wrong_modules() {
    return DB.query(
      "SELECT module_name, COUNT(*) c FROM wrong_questions " +
      "WHERE status='active' GROUP BY module_name ORDER BY c DESC").map(function (r) {
        return { name: r.module_name || "未分类", count: r.c };
      });
  }

  function wrong_record_answer(payload) {
    payload = payload || {};
    var wrongId = parseInt(payload.id, 10);
    var answer = String(payload.answer || "").trim();
    var row = DB.queryOne("SELECT id FROM wrong_questions WHERE id=?", [wrongId]);
    if (!row) throw err("错题不存在。");
    DB.execute("UPDATE wrong_questions SET my_answer=? WHERE id=?", [answer, wrongId]);
    return { id: wrongId, myAnswer: answer };
  }

  function wrong_action(wrongId, action) {
    var row = DB.queryOne("SELECT * FROM wrong_questions WHERE id=?", [parseInt(wrongId, 10)]);
    if (!row) throw err("错题不存在。");
    var t = DB.nowMs();
    if (action === "review") {
      var mastery = Math.min(95, (row.mastery || 0) + 25);
      var days = mastery <= 40 ? 1 : (mastery <= 70 ? 3 : 7);
      var nxt = t + days * 86400 * 1000;
      DB.execute(
        "UPDATE wrong_questions SET mastery=?,last_review_at=?,next_review_at=? WHERE id=?",
        [mastery, t, nxt, row.id]);
      return { mastery: mastery, nextReviewLabel: msToDateLabel(nxt) };
    }
    if (action === "master") {
      DB.execute(
        "UPDATE wrong_questions SET status='mastered',mastery=100," +
        "last_review_at=?,next_review_at=NULL WHERE id=?", [t, row.id]);
      return { status: "mastered" };
    }
    if (action === "reactivate") {
      DB.execute(
        "UPDATE wrong_questions SET status='active',next_review_at=? WHERE id=?",
        [t + 86400 * 1000, row.id]);
      return { status: "active" };
    }
    throw err("未知操作：" + action);
  }

  function wrong_sync(payload) {
    payload = payload || {};
    var prefix = payload.prefix || "xingce";
    var module = payload.module || "";
    return Fenbi.syncWrong(prefix, module, function (done, total, phase) {
      emit("wrongSync:progress", { done: done, total: total, phase: phase });
    });
  }

  /* ------------------------------------------------------- 笔记 ---- */
  function notes_list(query) {
    var sql = "SELECT * FROM notes";
    var params = [];
    if (query) {
      sql += " WHERE title LIKE ? OR body LIKE ? OR tags LIKE ?";
      params.push("%" + query + "%", "%" + query + "%", "%" + query + "%");
    }
    sql += " ORDER BY updated_at DESC";
    return DB.query(sql, params);
  }

  function notes_save(note) {
    var t = DB.nowMs();
    if (note.id) {
      DB.execute(
        "UPDATE notes SET title=?,body=?,tags=?,linked_global=?,updated_at=? WHERE id=?",
        [note.title || "无标题", note.body || "", note.tags || "",
         note.linked_global || "", t, note.id]);
      return { id: note.id };
    }
    var newId = DB.insert(
      "INSERT INTO notes(title,body,tags,linked_global,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      [note.title || "无标题", note.body || "", note.tags || "",
       note.linked_global || "", t, t]);
    return { id: newId };
  }

  function notes_delete(noteId) {
    DB.execute("DELETE FROM notes WHERE id=?", [parseInt(noteId, 10)]);
  }

  /* 手机版：导出为 Markdown 文件到 Documents 目录（PDF 生成依赖电脑端组件）。 */
  async function notes_export_pdf(noteId) {
    var row = DB.queryOne("SELECT * FROM notes WHERE id=?", [parseInt(noteId, 10)]);
    if (!row) throw err("笔记不存在，请先保存后再导出。");
    var title = row.title || "无标题";
    var safe = title.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 40) || "笔记";
    var filename = safe + ".md";
    var FS = window.Capacitor.Plugins.Filesystem;
    await FS.writeFile({
      path: filename, data: row.body || "",
      directory: "DOCUMENTS", recursive: true, encoding: "UTF8",
    });
    return { path: "Documents/" + filename };
  }

  /* ------------------------------------------------------- 计划 ---- */
  function plan_overview(monthOffset) {
    monthOffset = parseInt(monthOffset, 10) || 0;
    var today = new Date();
    var first = new Date(today.getFullYear(), today.getMonth(), 1);
    first = new Date(first.getFullYear(), first.getMonth(), 1 + 32 * monthOffset);
    first = new Date(first.getFullYear(), first.getMonth(), 1);
    var nDays = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    var checkins = {};
    DB.query("SELECT date FROM checkins").forEach(function (r) { checkins[r.date] = 1; });
    var todayStr = fmtDate(today);

    var cells = [];
    var lead = (first.getDay() + 6) % 7;
    for (var i = 0; i < lead; i++) cells.push({ empty: true });
    for (var day = 1; day <= nDays; day++) {
      var ds = first.getFullYear() + "-" + pad2(first.getMonth() + 1) + "-" + pad2(day);
      cells.push({ day: day, checked: !!checkins[ds], isToday: ds === todayStr });
    }

    var labels = ["一", "二", "三", "四", "五", "六", "日"];
    var bars = [];
    for (var k = 6; k >= 0; k--) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - k);
      var s0 = midnight(d), s1 = s0 + 86400 * 1000;
      var sess = DB.queryOne(
        "SELECT COALESCE(SUM(duration_sec),0) s FROM practice_sessions " +
        "WHERE finished_at>=? AND finished_at<?", [s0, s1]).s;
      var focus = DB.queryOne(
        "SELECT COALESCE(SUM(duration_sec),0) s FROM focus_logs " +
        "WHERE started_at>=? AND started_at<?", [s0, s1]).s;
      bars.push({
        label: labels[(d.getDay() + 6) % 7],
        minutes: Math.round((sess + focus) / 60),
      });
    }

    var general = DB.getSetting("general");
    var countdown = null;
    if (general.exam_date) {
      var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(general.exam_date);
      if (m) {
        var ed = new Date(+m[1], +m[2] - 1, +m[3]);
        countdown = {
          days: Math.round((ed.getTime() - midnight(today)) / 86400000),
          name: general.exam_name || "考试",
        };
      }
    }

    return {
      monthLabel: first.getFullYear() + "年" + (first.getMonth() + 1) + "月",
      cells: cells, bars: bars, countdown: countdown,
    };
  }

  function tasks_list(day) {
    day = day || DB.todayStr();
    return DB.query("SELECT * FROM tasks WHERE date=? ORDER BY required DESC,id", [day]);
  }

  function tasks_save(task) {
    var day = task.date || DB.todayStr();
    if (task.id) {
      DB.execute(
        "UPDATE tasks SET title=?,detail=?,duration_min=?,required=? WHERE id=?",
        [task.title || "", task.detail || "",
         parseInt(task.duration_min, 10) || 0, task.required ? 1 : 0, task.id]);
      return { id: task.id };
    }
    var newId = DB.insert(
      "INSERT INTO tasks(date,title,detail,duration_min,required,source,created_at) VALUES(?,?,?,?,?,'manual',?)",
      [day, task.title || "", task.detail || "",
       parseInt(task.duration_min, 10) || 0, task.required ? 1 : 0, DB.nowMs()]);
    return { id: newId };
  }

  function tasks_toggle(taskId) {
    var row = DB.queryOne("SELECT * FROM tasks WHERE id=?", [parseInt(taskId, 10)]);
    if (!row) throw err("任务不存在。");
    if (row.status === "done") {
      DB.execute("UPDATE tasks SET status='todo',finished_at=NULL WHERE id=?", [row.id]);
      return { status: "todo" };
    }
    DB.execute("UPDATE tasks SET status='done',finished_at=? WHERE id=?",
      [DB.nowMs(), row.id]);
    DB.insert("INSERT OR IGNORE INTO checkins(date,created_at) VALUES(?,?)",
      [DB.todayStr(), DB.nowMs()]);
    return { status: "done" };
  }

  function tasks_delete(taskId) {
    DB.execute("DELETE FROM tasks WHERE id=?", [parseInt(taskId, 10)]);
  }

  async function tasks_ai_generate() {
    var general = DB.getSetting("general");
    var rpt = Reports.buildReport("week");
    var system = "你是公考督学老师。根据学生的考试信息和本周数据，为今天安排3-5个学习任务。" +
      "只输出JSON数组，每个元素含 title(任务名,15字内), duration_min(分钟数)," +
      "required(是否今日必做,布尔值), detail(一句话说明为什么安排)。不要输出其他文字。";
    var examDays = null;
    if (general.exam_date) {
      var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(general.exam_date);
      if (m) {
        var ed = new Date(+m[1], +m[2] - 1, +m[3]);
        examDays = Math.round((ed.getTime() - midnight(new Date())) / 86400000);
      }
    }
    var wrongN = DB.queryOne(
      "SELECT COUNT(*) c FROM wrong_questions WHERE status='active'").c;
    var user = JSON.stringify({
      考试: general.exam_name,
      距考试天数: examDays,
      本周刷题: rpt.questions,
      本周正确率: rpt.accuracy + "%",
      薄弱模块: rpt.modules.slice(0, 2).map(function (x) { return x.name + x.accuracy + "%"; }),
      待复习错题数: wrongN,
    });
    var text = await AI.chatText(system, user, 0.4);
    var m2 = /\[[\s\S]*\]/.exec(text);
    if (!m2) throw err("AI 返回内容无法解析，请重试。");
    var arr;
    try { arr = JSON.parse(m2[0]); }
    catch (e) { throw err("AI 返回的任务格式有误，请重试。"); }

    var today = DB.todayStr();
    var existing = {};
    DB.query("SELECT title FROM tasks WHERE date=?", [today]).forEach(function (r) {
      existing[r.title] = 1;
    });
    arr.forEach(function (t) {
      var title = String(t.title || "").trim();
      if (!title || existing[title]) return;
      DB.insert(
        "INSERT INTO tasks(date,title,detail,duration_min,required,source,created_at) VALUES(?,?,?,?,?,'ai',?)",
        [today, title, String(t.detail || ""),
         parseInt(t.duration_min, 10) || 30, t.required ? 1 : 0, DB.nowMs()]);
      existing[title] = 1;
    });
    return tasks_list(today);
  }

  function focus_save(durationSec, title) {
    durationSec = parseInt(durationSec, 10) || 0;
    if (durationSec < 10) throw err("时长太短，无法记录。");
    DB.insert(
      "INSERT INTO focus_logs(date,started_at,duration_sec,title) VALUES(?,?,?,?)",
      [DB.todayStr(), DB.nowMs() - durationSec * 1000, durationSec, title || "专注学习"]);
    return { ok: true };
  }

  /* ------------------------------------------------------- 报告 ---- */
  function report_data(period) { return Reports.buildReport(period || "week"); }
  function report_ai_review(period) { return Reports.aiReview(period || "week"); }

  function share_generate() {
    throw err("手机版暂不支持生成学习海报，请使用电脑版。");
  }
  function share_save() {
    throw err("手机版暂不支持保存海报，请使用电脑版。");
  }

  /* ------------------------------------------------------- 设置 ---- */
  function model_test(cfg) { return AI.testConnection(cfg); }
  function model_save(cfg) { DB.setSetting("model", cfg); }
  function privacy_save(privacy) { DB.setSetting("privacy", privacy); }
  function general_save(general) { DB.setSetting("general", general); }

  async function fenbi_save_cookie(cookie) {
    cookie = (cookie || "").trim();
    DB.setSetting("fenbi_cookie", cookie);
    Fenbi.resetSession();
    var info = await Fenbi.whoami();
    emit("toast", { kind: "ok", title: "粉笔账号已连接",
      text: "Cookie 有效，可以开始刷题了。" });
    return info;
  }

  async function fenbi_logout() {
    DB.setSetting("fenbi_cookie", "");
    Fenbi.resetSession();
    var nb = NB();
    try { if (nb && nb.clearFenbiCookies) nb.clearFenbiCookies(); } catch (e) {}
    emit("toast", { kind: "info", title: "已退出粉笔账号",
      text: "本地学习数据已保留，可随时重新扫码登录。" });
    return { ok: true };
  }

  /* ------------------------------------------- 扫码 / 原生登录 ---- */
  /* 原生登录 Activity 完成（或取消）后回调以下两个全局函数。 */
  window.__androidLoginResult = async function (cookieStr) {
    try {
      var pairs = parseCookieStr(cookieStr);
      if (!pairs.userid || !(pairs.sess || pairs.persistent)) {
        emit("fenbiLogin:closed", {});
        return;
      }
      DB.setSetting("fenbi_cookie", orderedCookieStr(pairs));
      Fenbi.resetSession();
      var info = await Fenbi.whoami();
      if (info && info.user) {
        var name = (info.user && info.user.name) || "";
        emit("fenbiLogin:success", { info: info, name: name });
        emit("toast", { kind: "ok", title: "粉笔账号已连接",
          text: "欢迎回来" + (name ? "，" + name : "") + "，可以开始刷题了。" });
      } else {
        emit("fenbiLogin:error", { text: "已取到网页登录 Cookie，但题库接口验证未通过，请稍后在设置里重试。" });
      }
    } catch (e) {
      emit("fenbiLogin:error", { text: String((e && e.message) || e) });
    }
  };
  window.__androidLoginClosed = function () { emit("fenbiLogin:closed", {}); };

  function fenbi_open_login_page() {
    var nb = NB();
    if (!nb || !nb.openLogin) {
      throw err("安卓原生登录组件未就绪，请退出应用后重新打开。");
    }
    nb.openLogin();
    return { ok: true };
  }

  function fenbi_cancel_login_page() {
    var nb = NB();
    try { if (nb && nb.closeLogin) nb.closeLogin(); } catch (e) {}
    return { ok: true };
  }

  async function fenbi_finish_login_page() {
    var nb = NB();
    var ck = (nb && nb.getLoginCookie) ? String(nb.getLoginCookie() || "") : "";
    var pairs = parseCookieStr(ck);
    if (!pairs.userid || !(pairs.sess || pairs.persistent)) {
      var keys = Object.keys(pairs);
      throw err("还没检测到登录状态。请在登录页完成扫码或登录，" +
        "完成后会自动连接（当前 Cookie 键：" + (keys.join(", ") || "空") + "）。");
    }
    DB.setSetting("fenbi_cookie", orderedCookieStr(pairs));
    Fenbi.resetSession();
    var info = await Fenbi.whoami();
    if (!(info && info.user)) {
      throw err("已取到网页登录 Cookie，但题库接口验证暂未通过（服务端可能还在下发会话），请稍等几秒后再点一次。");
    }
    var name = (info.user && info.user.name) || "";
    emit("fenbiLogin:success", { info: info, name: name });
    return info;
  }

  function fenbi_debug_cookies() {
    var nb = NB();
    var ck = (nb && nb.getLoginCookie) ? String(nb.getLoginCookie() || "") : "";
    var pairs = parseCookieStr(ck);
    return {
      url: "(安卓原生登录页)",
      docCookie: "",
      nativeCookie: orderedCookieStr(pairs),
      keys: Object.keys(pairs).sort(),
      has_sid: !!pairs.sid,
      has_userid: !!pairs.userid,
      cookie_count: Object.keys(pairs).length,
      source: ck ? "安卓原生 CookieManager（含 HttpOnly）" : "尚未打开登录页或暂无 Cookie",
    };
  }

  /* ------------------------------------------------------- 备份 ---- */
  function pickFileB64() {
    return new Promise(function (resolve, reject) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".db,application/octet-stream";
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0];
        if (!f) { reject(err("未选择文件。")); inp.remove(); return; }
        var r = new FileReader();
        r.onload = function () {
          var s = String(r.result || "");
          resolve({ name: f.name, b64: s.indexOf(",") >= 0 ? s.split(",")[1] : s });
        };
        r.onerror = function () { reject(err("读取文件失败。")); };
        r.readAsDataURL(f);
        setTimeout(function () { try { inp.remove(); } catch (e) {} }, 60000);
      });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  async function backup_export() {
    var FS = window.Capacitor.Plugins.Filesystem;
    var filename = "fenbi_backup_" + fmtDate(new Date()).replace(/-/g, "") + ".db";
    await FS.writeFile({
      path: filename, data: DB.exportB64(),
      directory: "DOCUMENTS", recursive: true,
    });
    return { path: "Documents/" + filename };
  }

  async function backup_import() {
    var pick = await pickFileB64();
    if (!DB.validateB64(pick.b64)) throw err("所选文件不是有效的备份。");
    DB.loadB64(pick.b64);
    await DB.persistNow();
    return { needRestart: true };
  }

  /* ------------------------------------------------------- 对话 ---- */
  var SYS_PROMPTS = {
    practice: "你叫小岸，是公考私教。规则：①不直接报答案，先用提问引导学生自己判断；" +
      "②学生明确要求讲解时，按「判断题型→找特征→推规律→定答案」分步讲；" +
      "③讲完给一句好记的口诀。语气像耐心的朋友。",
    wrong: "你叫小岸，是公考私教。针对错题：先判断错因类型（知识盲区/概念混淆/" +
      "审题失误/方法错误/粗心），再解释误区，给出针对性练习建议。" +
      "不要空泛安慰，要具体到这道题。",
    plan: "你叫小岸，是公考督学老师。帮助学生安排和调整学习计划，兼顾可执行性。" +
      "学生请假或顺延任务时，主动给出替代安排，并鼓励保持连续打卡。",
    notes: "你叫小岸，是公考私教。帮助学生整理笔记、压缩记忆点、出检测题。",
    report: "你叫小岸，是公考私教。结合学习报告数据解读亮点与短板，并把建议落成" +
      "可执行的任务。",
    general: "你叫小岸，是公考私教。围绕公务员考试备考回答问题，简洁具体。",
  };

  function chat_history(limit) {
    var rows = DB.query(
      "SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?", [parseInt(limit, 10) || 30]);
    return rows.reverse();
  }

  function chat_clear() {
    DB.execute("DELETE FROM chat_messages");
  }

  function chat_send(payload) {
    var text = (payload.text || "").trim();
    if (!text) throw err("消息不能为空。");
    var ctxType = payload.ctxType || "general";
    var ctxData = payload.ctxData || {};

    DB.insert("INSERT INTO chat_messages(role,content,ctx_type,created_at) VALUES(?,?,?,?)",
      ["user", text, ctxType, DB.nowMs()]);
    var mid = DB.insert(
      "INSERT INTO chat_messages(role,content,ctx_type,created_at) VALUES('assistant','',?,?)",
      [ctxType, DB.nowMs()]);

    var history = DB.query(
      "SELECT role,content FROM chat_messages WHERE id<? ORDER BY id DESC LIMIT 12",
      [mid]).reverse();
    var messages = [{
      role: "system",
      content: SYS_PROMPTS[ctxType] || SYS_PROMPTS.general,
    }];
    history.forEach(function (r) {
      if (r.content) messages.push({ role: r.role, content: r.content });
    });
    if (ctxData && Object.keys(ctxData).length) {
      messages[messages.length - 1] = {
        role: "user",
        content: "【当前上下文】\n" + JSON.stringify(ctxData) + "\n\n" + text,
      };
    }

    /* 流式降级为一次性返回，事件时序与桌面版保持一致。 */
    AI.streamChat(messages,
      function (piece) { emit("chat:delta", { id: mid, piece: piece }); },
      function (full) {
        DB.execute("UPDATE chat_messages SET content=? WHERE id=?", [full, mid]);
        emit("chat:done", { id: mid });
      },
      function (e2) { emit("chat:error", { id: mid, error: e2 }); });
    return { id: mid };
  }

  /* ------------------------------------------------------- 挂载 ---- */
  window.AndroidAPI = {
    app_init: app_init,
    fenbi_whoami: fenbi_whoami,
    fenbi_keypoints: fenbi_keypoints,
    fenbi_labels: fenbi_labels,
    fenbi_papers: fenbi_papers,
    practice_start_keypoint: practice_start_keypoint,
    practice_start_paper: practice_start_paper,
    practice_similar: practice_similar,
    practice_submit: practice_submit,
    practice_history: practice_history,
    practice_history_detail: practice_history_detail,
    wrong_list: wrong_list, wrong_modules: wrong_modules,
    wrong_record_answer: wrong_record_answer, wrong_action: wrong_action,
    wrong_sync: wrong_sync,
    notes_list: notes_list, notes_save: notes_save,
    notes_delete: notes_delete, notes_export_pdf: notes_export_pdf,
    plan_overview: plan_overview,
    tasks_list: tasks_list, tasks_save: tasks_save,
    tasks_toggle: tasks_toggle, tasks_delete: tasks_delete,
    tasks_ai_generate: tasks_ai_generate,
    focus_save: focus_save,
    report_data: report_data, report_ai_review: report_ai_review,
    share_generate: share_generate, share_save: share_save,
    model_test: model_test, model_save: model_save,
    privacy_save: privacy_save, general_save: general_save,
    fenbi_save_cookie: fenbi_save_cookie, fenbi_logout: fenbi_logout,
    fenbi_open_login_page: fenbi_open_login_page,
    fenbi_cancel_login_page: fenbi_cancel_login_page,
    fenbi_finish_login_page: fenbi_finish_login_page,
    fenbi_debug_cookies: fenbi_debug_cookies,
    backup_export: backup_export, backup_import: backup_import,
    chat_history: chat_history, chat_clear: chat_clear, chat_send: chat_send,
  };
})();
