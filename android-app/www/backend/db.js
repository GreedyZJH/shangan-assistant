/* 本地 SQLite 数据层（sql.js），与桌面版 backend/storage.py 同构。
 * 数据持久化到应用私有目录 fenbi_app.db；写操作后自动防抖保存。 */
(function () {
  "use strict";

  const SCHEMA = "CREATE TABLE IF NOT EXISTS kv_settings(k TEXT PRIMARY KEY, v TEXT);\n" +
"CREATE TABLE IF NOT EXISTS practice_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at INTEGER, finished_at INTEGER,kind TEXT, source_id TEXT, source_name TEXT, prefix TEXT, ex_key TEXT,total_count INTEGER DEFAULT 0, correct_count INTEGER DEFAULT 0,duration_sec INTEGER DEFAULT 0);\n" +
"CREATE TABLE IF NOT EXISTS question_results(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id INTEGER, created_at INTEGER, global_id TEXT,module_name TEXT, keypoint TEXT, correct INTEGER, source TEXT DEFAULT 'practice');\n" +
"CREATE TABLE IF NOT EXISTS wrong_questions(id INTEGER PRIMARY KEY AUTOINCREMENT,global_id TEXT UNIQUE, question_id TEXT, prefix TEXT,module_name TEXT, keypoint TEXT, content_html TEXT, options_json TEXT,material_html TEXT, my_answer TEXT, correct_answer TEXT,analysis TEXT, source TEXT,wrong_count INTEGER DEFAULT 1, mastery INTEGER DEFAULT 20,status TEXT DEFAULT 'active',created_at INTEGER, last_review_at INTEGER, next_review_at INTEGER, starred INTEGER DEFAULT 0);\n" +
"CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT, body TEXT, tags TEXT, linked_global TEXT,created_at INTEGER, updated_at INTEGER);\n" +
"CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT, title TEXT, detail TEXT, duration_min INTEGER,required INTEGER DEFAULT 0, source TEXT DEFAULT 'manual',status TEXT DEFAULT 'todo', created_at INTEGER, finished_at INTEGER);\n" +
"CREATE TABLE IF NOT EXISTS checkins(date TEXT PRIMARY KEY, created_at INTEGER);\n" +
"CREATE TABLE IF NOT EXISTS focus_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT, started_at INTEGER, duration_sec INTEGER, title TEXT);\n" +
"CREATE TABLE IF NOT EXISTS chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,role TEXT, content TEXT, ctx_type TEXT, created_at INTEGER);\n" +
"CREATE TABLE IF NOT EXISTS share_records(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at INTEGER, period TEXT, channel TEXT, file_path TEXT);";

  const DEFAULTS = {
    model: { provider: "DeepSeek", base_url: "https://api.deepseek.com/v1", api_key: "", model: "deepseek-chat", temperature: 0.3 },
    fenbi_cookie: "",
    general: { exam_name: "公务员笔试", exam_date: "", daily_target: 60, reminder_time: "19:00", strict_mode: true, nickname: "" },
    privacy: { anonymous: false, hide_phone: true, current_only: false },
  };

  const DB_FILE = "fenbi_app.db";
  let db = null;
  let saveTimer = null;
  let readyResolve = null;
  const ready = new Promise(function (r) { readyResolve = r; });

  function nowMs() { return Date.now(); }
  function todayStr() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function b64FromBytes(bytes) {
    var bin = "", chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function bytesFromB64(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function persistNow() {
    if (!db || !window.Capacitor) return;
    var data = b64FromBytes(db.export());
    await window.Capacitor.Plugins.Filesystem.writeFile({
      path: DB_FILE, data: data, directory: "DATA", recursive: true,
    });
  }
  function schedulePersist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { persistNow().catch(console.error); }, 600);
  }
  function query(sql, params) {
    var stmt = db.prepare(sql);
    try {
      stmt.bind(params || []);
      var rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally { stmt.free(); }
  }
  function queryOne(sql, params) {
    var rows = query(sql, params);
    return rows.length ? rows[0] : null;
  }
  function execute(sql, params) {
    var stmt = db.prepare(sql);
    try { stmt.bind(params || []); stmt.step(); } finally { stmt.free(); }
    schedulePersist();
  }
  function insert(sql, params) {
    execute(sql, params);
    return queryOne("SELECT last_insert_rowid() AS id").id;
  }
  function rowsToDicts(rows) { return rows; }
  function deepMerge(base, saved) {
    if (saved === null || saved === undefined) return base;
    if (typeof base !== "object" || Array.isArray(base)) return saved;
    var out = Object.assign({}, base);
    Object.keys(saved).forEach(function (k) { out[k] = saved[k]; });
    return out;
  }
  function getSetting(key) {
    var row = queryOne("SELECT v FROM kv_settings WHERE k=?", [key]);
    var def = DEFAULTS[key] !== undefined ? DEFAULTS[key] : {};
    if (!row) return JSON.parse(JSON.stringify(def));
    try { return deepMerge(def, JSON.parse(row.v)); }
    catch (e) { return JSON.parse(JSON.stringify(def)); }
  }
  function setSetting(key, value) {
    execute(
      "INSERT INTO kv_settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
      [key, JSON.stringify(value)]);
  }
  function createSession(kind, sourceId, sourceName, prefix, exKey, total) {
    return insert(
      "INSERT INTO practice_sessions(created_at,kind,source_id,source_name,prefix,ex_key,total_count) VALUES(?,?,?,?,?,?,?)",
      [nowMs(), kind, String(sourceId), sourceName, prefix, exKey, total]);
  }
  function finishSession(sessionId, correct, durationSec) {
    execute("UPDATE practice_sessions SET finished_at=?,correct_count=?,duration_sec=? WHERE id=?",
      [nowMs(), correct, durationSec, sessionId]);
  }
  function addQuestionResult(sessionId, globalId, moduleName, keypoint, correct, source) {
    insert("INSERT INTO question_results(session_id,created_at,global_id,module_name,keypoint,correct,source) VALUES(?,?,?,?,?,?,?)",
      [sessionId, nowMs(), globalId, moduleName, keypoint, correct ? 1 : 0, source || "practice"]);
  }
  function getWrongByGlobal(globalId) {
    return queryOne("SELECT * FROM wrong_questions WHERE global_id=?", [globalId]);
  }
  function upsertWrong(item) {
    var existing = getWrongByGlobal(item.global_id);
    var t = nowMs();
    if (existing) {
      execute("UPDATE wrong_questions SET wrong_count=wrong_count+1, mastery=20,status='active', my_answer=?, correct_answer=?, content_html=?,options_json=?, material_html=?, analysis=?, source=?,module_name=?, keypoint=?, last_review_at=NULL, next_review_at=? WHERE global_id=?",
        [item.my_answer, item.correct_answer, item.content_html, JSON.stringify(item.options), item.material_html || "", item.analysis, item.source || "", item.module_name || "", item.keypoint || "", t + 3600 * 1000 * 8, item.global_id]);
    } else {
      insert("INSERT INTO wrong_questions(global_id,question_id,prefix,module_name,keypoint,content_html,options_json,material_html,my_answer,correct_answer,analysis,source,wrong_count,mastery,status,created_at,next_review_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,20,'active',?,?)",
        [item.global_id, item.question_id || "", item.prefix || "xingce", item.module_name || "", item.keypoint || "", item.content_html, JSON.stringify(item.options), item.material_html || "", item.my_answer, item.correct_answer, item.analysis, item.source || "", 1, t, t + 3600 * 1000 * 8]);
    }
  }
  function upsertCloudWrong(item) {
    var existing = getWrongByGlobal(item.global_id);
    var t = nowMs();
    if (existing) {
      execute("UPDATE wrong_questions SET prefix=?, module_name=?, keypoint=?,content_html=?, options_json=?, material_html=?, correct_answer=?,analysis=?, source=COALESCE(NULLIF(?,''),source), question_id=? WHERE global_id=?",
        [item.prefix || "xingce", item.module_name || "", item.keypoint || "", item.content_html || "", JSON.stringify(item.options || []), item.material_html || "", item.correct_answer || "", item.analysis || "", item.source || "", item.question_id || "", item.global_id]);
      return false;
    }
    insert("INSERT INTO wrong_questions(global_id,question_id,prefix,module_name,keypoint,content_html,options_json,material_html,my_answer,correct_answer,analysis,source,wrong_count,mastery,status,created_at,next_review_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,20,'active',?,?)",
      [item.global_id, item.question_id || "", item.prefix || "xingce", item.module_name || "", item.keypoint || "", item.content_html || "", JSON.stringify(item.options || []), item.material_html || "", item.my_answer || "", item.correct_answer || "", item.analysis || "", item.source || "", t, t + 3600 * 1000 * 8]);
    return true;
  }
  async function init() {
    var SQL = await window.initSqlJs({ locateFile: function (f) { return "sqljs/" + f; } });
    var bytes = null;
    try {
      var file = await window.Capacitor.Plugins.Filesystem.readFile({
        path: DB_FILE, directory: "DATA",
      });
      bytes = bytesFromB64(file.data);
    } catch (e) { bytes = null; }
    db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    db.exec(SCHEMA);
    migrate();
    readyResolve();
  }
  /* 轻量迁移：为老库补充新增列（重复执行安全） */
  function addColIfMissing(table, col, ddl) {
    var cols = [];
    db.exec("PRAGMA table_info(" + table + ")").forEach(function (rs) {
      rs.values.forEach(function (v) { cols.push(String(v[1])); });
    });
    if (cols.indexOf(col) < 0) db.exec("ALTER TABLE " + table + " ADD COLUMN " + ddl);
  }
  function migrate() {
    addColIfMissing("question_results", "source", "source TEXT DEFAULT 'practice'");
    addColIfMissing("wrong_questions", "starred", "starred INTEGER DEFAULT 0");
  }
  function validateB64(b64) {
    var tmp;
    try { tmp = new SQL.Database(bytesFromB64(b64)); }
    catch (e) { return false; }
    try {
      var names = [];
      tmp.exec("SELECT name FROM sqlite_master WHERE type='table'").forEach(function (rs) {
        rs.values.forEach(function (v) { names.push(String(v[0])); });
      });
      return names.indexOf("kv_settings") >= 0;
    } catch (e2) { return false; }
    finally { try { tmp.close(); } catch (e3) {} }
  }
  window.DB = {
    ready: ready, init: init, nowMs: nowMs, todayStr: todayStr,
    query: query, queryOne: queryOne, execute: execute, insert: insert,
    rowsToDicts: rowsToDicts, getSetting: getSetting, setSetting: setSetting,
    createSession: createSession, finishSession: finishSession,
    addQuestionResult: addQuestionResult, getWrongByGlobal: getWrongByGlobal,
    upsertWrong: upsertWrong, upsertCloudWrong: upsertCloudWrong,
    persistNow: persistNow, validateB64: validateB64,
    exportB64: function () { return b64FromBytes(db.export()); },
    loadB64: function (b64) {
      db = new SQL.Database(bytesFromB64(b64));
      db.exec(SCHEMA);
      migrate();
      schedulePersist();
    },
  };
})();
