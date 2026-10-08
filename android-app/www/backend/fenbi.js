/* 粉笔题库客户端 + 服务层（翻译自 fenbi_client.py / fenbi_svc.py）。
 * 网络请求走 CapacitorHttp（原生层，绕过 WebView CORS 限制）。 */
(function () {
  "use strict";

  const TIKU = "https://tiku.fenbi.com";
  const LOGIN = "https://login.fenbi.com";
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  class FenbiError extends Error {}
  class FenbiAuthError extends FenbiError {}

  const CapHttp = () => window.Capacitor.Plugins.CapacitorHttp;

  async function request(method, url, opts) {
    opts = opts || {};
    const cookie = getCookie();
    const headers = Object.assign(
      { "User-Agent": UA, Cookie: cookie, Accept: "application/json, text/plain, */*" },
      opts.headers || {}
    );
    let data;
    if (opts.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      data = opts.form;
    } else if (opts.json) {
      headers["Content-Type"] = "application/json";
      data = opts.json;
    }
    let resp;
    try {
      resp = await CapHttp().request({ url: url, method: method, headers: headers, data: data, readTimeout: 30000, connectTimeout: 15000 });
    } catch (e) {
      throw new FenbiError("网络请求失败：" + url + " (" + (e && e.message || e) + ")");
    }
    if (resp.status === 401 || resp.status === 403)
      throw new FenbiAuthError("鉴权失败（HTTP " + resp.status + "），登录可能已过期，请重新扫码登录。");
    return resp.data;
  }

  function getCookie() {
    const c = (DB.getSetting("fenbi_cookie") || "").trim();
    if (!c)
      throw new FenbiAuthError("尚未连接粉笔账号，请在【设置 → 粉笔账号】中扫码登录。");
    return c;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------------- 富文本：AST / HTML → HTML ---------------- */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  /* 填空横线：题面里的连续空白（半角空格 / 不间断空格 \u00a0）渲染为下划线占位 */
  function blankify(s) {
    return String(s).replace(/[\u00a0 ]{2,}/g, '<span class="q-blank"></span>');
  }
  function blankifyHtml(s) {
    return String(s).replace(/>([^<]*)</g, function (m, txt) {
      return ">" + blankify(txt.replace(/&nbsp;/g, "\u00a0")) + "<";
    });
  }
  function parseMaybeJson(raw) {
    if (typeof raw === "string") {
      const t = raw.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try { return JSON.parse(t); } catch (e) { return raw; }
      }
    }
    return raw;
  }
  function imgSrc(n) {
    let u = "";
    for (const k of ["value", "url", "src"]) {
      const v = n[k];
      if (typeof v === "string" && v.trim()) { u = v.trim(); break; }
      if (v && typeof v === "object") {
        const w = v.url || v.src;
        if (w) { u = String(w); break; }
      }
    }
    if (!u) return "";
    if (u.indexOf("http") !== 0)
      u = "https://tiku.fenbi.com/api/questions/images/" + u.replace(/^\/+/, "");
    return u;
  }
  function astToHtml(node) {
    const parts = [];
    function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== "object") return;
      const name = n.name;
      const children = n.children || [];
      if (name === "txt") parts.push(blankify(esc(n.value || "")));
      else if (name === "img") {
        const src = imgSrc(n);
        if (src) parts.push('<img class="q-img" src="' + esc(src) + '" alt="题目图片" onerror="this.style.display=\'none\'">');
      } else if (name === "p") {
        parts.push("<p>"); children.forEach(walk); parts.push("</p>");
      } else if (name === "li") {
        parts.push("<li>"); children.forEach(walk); parts.push("</li>");
      } else if (name === "ul" || name === "ol") {
        parts.push("<" + name + ">"); children.forEach(walk); parts.push("</" + name + ">");
      } else children.forEach(walk);
    }
    walk(node);
    const out = parts.join("");
    return out.trim() ? out : "";
  }
  function richToHtml(raw) {
    if (raw === null || raw === undefined) return "";
    if (typeof raw === "object") return astToHtml(raw);
    const s = String(raw).trim();
    if (s.startsWith("{") || s.startsWith("[")) {
      try { const converted = astToHtml(JSON.parse(s)); if (converted) return converted; }
      catch (e) {}
    }
    const text = String(raw);
    if (text.indexOf("<") === -1)
      return blankify(esc(text)).replace(/\n/g, "<br>");
    return blankifyHtml(text);
  }
  /* ---------------- 富文本 → 纯文本（解析区用，与桌面版一致） -------- */
  function cleanText(s) {
    s = String(s).replace(/\xa0/g, " ");
    s = s.replace(/[ \t]+\n/g, "\n");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }
  function astToText(node) {
    if (typeof node === "string") {
      const t = node.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try { return astToText(JSON.parse(t)); } catch (e) { return node; }
      }
      return cleanText(node);
    }
    const parts = [];
    (function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== "object") return;
      if (n.name === "txt") parts.push(String(n.value || ""));
      else if (n.name === "img") parts.push("[图片]");
      (n.children || []).forEach(walk);
      if ((n.name === "p" || n.name === "doc") && parts.length && !parts[parts.length - 1].endsWith("\n"))
        parts.push("\n");
    })(node);
    return cleanText(parts.join(""));
  }
  function htmlToText(raw) {
    if (!raw) return "";
    let s = String(raw).replace(/<img[^>]*>/gi, "[图片]")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    const ent = { "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ", "#39": "'" };
    s = s.replace(/&(#?\w+);/g, function (m, c) {
      if (ent[c] !== undefined) return ent[c];
      if (/^#\d+$/.test(c)) return String.fromCharCode(parseInt(c.slice(1), 10));
      if (/^#x[0-9a-f]+$/i.test(c)) return String.fromCharCode(parseInt(c.slice(1), 16));
      return m;
    });
    return cleanText(s);
  }
  function richToText(raw) {
    if (raw === null || raw === undefined) return "";
    if (typeof raw !== "string") return astToText(raw);
    const stripped = raw.trim();
    if (stripped.startsWith("{") || stripped.startsWith("[")) {
      try { return astToText(JSON.parse(stripped)); } catch (e) {}
    }
    return htmlToText(raw);
  }
  function extractOptionsHtml(accessories) {
    for (const acc of accessories || [])
      if (acc && acc.options) return acc.options.map(function (o) {
        /* 选项里的连续空格只是词组分隔，不转填空横线 */
        return richToHtml(o).replace(/<span class="q-blank"><\/span>/g, " ");
      });
    return [];
  }
  function extractOptionsText(accessories) {
    for (const acc of accessories || [])
      if (acc && acc.options) return acc.options.map(richToText);
    return [];
  }
  function indexToLetter(index) {
    if (index === null || index === undefined) return "";
    return String(index).trim().split(",").map(function (t) {
      t = t.trim();
      return /^\d+$/.test(t) ? String.fromCharCode(65 + parseInt(t, 10)) : t;
    }).join(",");
  }

  /* ---------------- 客户端方法 ---------------- */
  async function listLabels(prefix) {
    const data = await request("GET", TIKU + "/api/" + prefix + "/comptroller/subLabels");
    const labels = data && typeof data === "object" && data.value ? data.value : data || [];
    return labels.map(function (lab) {
      const meta = lab.labelMeta || {};
      return { id: lab.id, name: lab.name, paperCount: meta.paperCount, difficulty: meta.difficulty };
    });
  }
  async function listPapers(prefix, labelId, page, pageSize, keyword) {
    const data = await request("GET",
      TIKU + "/api/" + prefix + "/comptroller/papers?toPage=" + page + "&pageSize=" + pageSize + "&labelId=" + labelId);
    const papers = (data.list || []).map(function (p) {
      const meta = p.paperMeta || {};
      return { id: p.id, name: p.name, date: p.date, exerciseCount: meta.exerciseCount, difficulty: meta.difficulty, lockStatus: p.lockStatus };
    });
    if (keyword) {
      const kw = keyword.trim();
      return { pageInfo: data.pageInfo || {}, papers: papers.filter(function (p) { return (p.name || "").indexOf(kw) >= 0; }) };
    }
    return { pageInfo: data.pageInfo || {}, papers: papers };
  }
  async function listKeypoints(prefix, refresh) {
    const data = await request("GET", TIKU + "/api/" + prefix + "/categories/home?filter=keypoint");
    const nodes = ((data || {}).data || {}).baseKeypointVOS || [];
    function convert(n) {
      return {
        id: n.id, name: n.name, count: n.count, answerCount: n.answerCount,
        lockStatus: n.lockStatus,
        children: Array.isArray(n.children) ? n.children.map(convert) : [],
      };
    }
    return nodes.map(convert);
  }
  async function createExercise(prefix, fields) {
    const body = Object.keys(fields).map(function (k) { return k + "=" + fields[k]; }).join("&");
    const data = await request("POST", TIKU + "/api/" + prefix + "/exercises", { form: body });
    return {
      key: data.key, id: data.id,
      name: (data.sheet || {}).name,
      questionCount: (data.sheet || {}).questionCount,
    };
  }
  async function getExerciseMeta(key, prefix) {
    const data = await request("GET",
      TIKU + "/combine/exercise/getExercise?format=json&key=" + key + "&routecs=" + prefix);
    return (data || {}).data || {};
  }
  async function getContentByMeta(meta, prefix) {
    const urls = ((meta.staticUrl || {}).urls) || [];
    if (!urls.length) throw new FenbiError("练习元信息中缺少 staticUrl。");
    let url = urls[0] + "&routecs=" + prefix;
    if (meta.sheetType !== null && meta.sheetType !== undefined)
      url += "&type=" + meta.sheetType;
    return request("GET", url);
  }

  /* ---------------- 会话层 ---------------- */
  let kpCache = {};
  async function keypointTree(prefix, refresh) {
    prefix = prefix || "xingce";
    if (refresh || !kpCache[prefix]) kpCache[prefix] = await listKeypoints(prefix, refresh);
    return kpCache[prefix];
  }
  function resetSession() { kpCache = {}; }

  function findModuleOfKeypoint(tree, kpId) {
    function walk(nodes, ancestors) {
      for (const n of nodes) {
        if (String(n.id) === String(kpId))
          return ancestors.length ? ancestors[0] : (n.name || "");
        const hit = walk(n.children || [], ancestors.concat([n.name || ""]));
        if (hit) return hit;
      }
      return "";
    }
    return walk(tree, []);
  }
  function findKeypointIdByName(tree, name) {
    name = (name || "").trim();
    if (!name) return null;
    let fallback = null;
    function walk(nodes) {
      for (const n of nodes) {
        if (n.name === name) {
          if (!n.children || !n.children.length) return n.id;
          if (fallback === null) fallback = n.id;
        }
        const hit = walk(n.children || []);
        if (hit !== null && hit !== undefined) return hit;
      }
      return null;
    }
    const hit = walk(tree);
    return hit !== null && hit !== undefined ? hit : fallback;
  }

  async function buildSession(exKey, prefix) {
    const meta = await getExerciseMeta(exKey, prefix);
    const content = await getContentByMeta(meta, prefix);
    const materials = {};
    for (const m of content.materials || []) {
      if (m.globalId) materials[m.globalId] = richToHtml(m.content);
    }
    const questions = (content.questions || []).map(function (q) {
      const mid = q.materialGlobalId || q.materialId;
      return {
        globalId: q.globalId, id: q.id, type: q.type,
        contentHtml: richToHtml(q.content),
        options: extractOptionsHtml(q.accessories),
        materialHtml: mid ? (materials[mid] || "") : "",
        difficulty: null,
      };
    });
    /* 批量补题目难度（失败不影响开卷练习） */
    const ids = questions.map(function (q) { return q.id; })
      .filter(function (x) { return x !== undefined && x !== null; });
    if (ids.length) {
      try {
        const brief = await questionsBrief(prefix, ids);
        questions.forEach(function (q) {
          const b = brief[String(q.id)];
          if (b) q.difficulty = b.difficulty;
        });
      } catch (e) {}
    }
    return {
      key: exKey, prefix: prefix,
      name: content.name || meta.name || "练习",
      questions: questions,
    };
  }
  async function startKeypoint(prefix, keypointId, limit) {
    const ex = await createExercise(prefix, { type: 3, keypointId: keypointId, limit: limit, exerciseTimeMode: 2 });
    const data = await buildSession(ex.key, prefix);
    data.sourceId = keypointId; data.kind = "keypoint";
    return data;
  }
  async function startPaper(prefix, paperId) {
    const ex = await createExercise(prefix, { type: 1, paperId: paperId, exerciseTimeMode: 2 });
    const data = await buildSession(ex.key, prefix);
    data.sourceId = paperId; data.kind = "paper";
    return data;
  }
  async function startSimilar(opts) {
    const prefix = opts.prefix || "xingce";
    const tree = await keypointTree(prefix);
    let kpId = opts.keypointId || null;
    if (kpId === null || kpId === undefined)
      kpId = findKeypointIdByName(tree, opts.keypointName || "");
    if ((kpId === null || kpId === undefined) && opts.moduleName) {
      for (const n of tree) if (n.name === opts.moduleName) { kpId = n.id; break; }
    }
    if (kpId === null || kpId === undefined)
      throw new FenbiError("无法识别该题的考点，暂时不能自动出同类题；可在左侧手动选择考点练习。");
    let data = null;
    for (let i = 0; i < 2; i++) {
      const ex = await createExercise(prefix, { type: 3, keypointId: parseInt(kpId, 10), limit: opts.limit || 2, exerciseTimeMode: 2 });
      data = await buildSession(ex.key, prefix);
      const gids = data.questions.map(function (q) { return q.globalId; });
      if (!opts.excludeGid || gids.indexOf(opts.excludeGid) < 0) break;
    }
    data.sourceId = kpId; data.kind = "keypoint";
    return data;
  }
  async function saveAnswers(exKey, prefix, answers) {
    const payload = answers.map(function (ans) {
      let answer = null;
      if (ans.choice !== undefined && ans.choice !== null) {
        let choice = String(ans.choice).trim();
        if (/^\d+$/.test(choice)) choice = indexToLetter(choice);
        answer = { choice: choice, type: "choice" };
      } else if (ans.blanks) {
        answer = { blanks: ans.blanks, type: "blankFilling" };
      } else return null;
      return {
        userAnswer: { key: ans.globalId, time: parseInt(ans.time || 0, 10), answer: answer },
        answered: true,
      };
    }).filter(Boolean);
    if (!payload.length) return false;
    const data = await request("POST",
      TIKU + "/combine/exercise/incrUpdate?key=" + exKey + "&routecs=" + prefix,
      { json: payload });
    return !!(data && data.data);
  }
  async function submitExercise(exKey, prefix) {
    const data = await request("POST", TIKU + "/combine/exercise/submit?key=" + exKey + "&routecs=" + prefix);
    return !!(data && data.data);
  }
  async function getSolutions(exKey, prefix) {
    const data = await request("GET",
      TIKU + "/combine/exercise/getSolution?format=json&key=" + exKey + "&routecs=" + prefix);
    const solMeta = (data || {}).data || {};
    const urls = ((solMeta.staticUrl || {}).urls) || [];
    if (!urls.length) throw new FenbiError("解析元信息中缺少 staticUrl，练习可能尚未交卷。");
    let solUrl = urls[0] + "&routecs=" + prefix;
    if (solMeta.sheetType !== null && solMeta.sheetType !== undefined)
      solUrl += "&type=" + solMeta.sheetType;
    let content = {};
    for (let i = 0; i < 8; i++) {
      content = await request("GET", solUrl);
      if (content.solutions) break;
      await sleep(1000);
    }
    const userAnswers = solMeta.userAnswers || {};
    const solutions = (content.solutions || []).map(function (s) { return formatSolution(s, userAnswers); });
    const materials = (content.materials || []).map(function (m) {
      return { id: m.id, globalId: m.globalId, content: richToText(m.content),
               contentHtml: richToHtml(m.content) };
    });
    return { name: content.name || solMeta.name, materials: materials, solutions: solutions };
  }
  function formatSolution(sol, userAnswers) {
    /* 解析区与桌面版一致用纯文本；题面/选项里的连续空格（填空横线）保留 */
    const options = extractOptionsText(sol.accessories);
    const correct = sol.correctAnswer || {};
    const choiceIndex = correct.choice;
    const letter = indexToLetter(choiceIndex);
    let correctText = "";
    if (letter && options.length) {
      const idxs = String(choiceIndex).split(",").map(function (t) { return t.trim(); })
        .filter(function (t) { return /^\d+$/.test(t); }).map(function (t) { return parseInt(t, 10); });
      correctText = idxs.filter(function (i) { return i < options.length; })
        .map(function (i) { return indexToLetter(i) + ". " + options[i]; }).join("；");
    }
    const my = userAnswers[sol.globalId] || {};
    return {
      id: sol.id, globalId: sol.globalId, type: sol.type,
      materialId: sol.materialId, materialGlobalId: sol.materialGlobalId,
      question: richToText(sol.content), contentHtml: richToHtml(sol.content),
      options: options, optionsHtml: extractOptionsHtml(sol.accessories),
      correctAnswer: letter, correctAnswerIndex: choiceIndex,
      correctAnswerText: correctText,
      analysis: richToText(sol.solution), analysisHtml: richToHtml(sol.solution),
      source: sol.source,
      keypoints: (sol.keypoints || []).map(function (k) { return k.name; }),
      myStatus: my.status,
    };
  }
  async function submitAndSolve(exKey, prefix, answers) {
    if (answers.length) { try { await saveAnswers(exKey, prefix, answers); } catch (e) { if (!(e instanceof FenbiError)) throw e; } }
    await submitExercise(exKey, prefix);
    const pack = await getSolutions(exKey, prefix);
    pack.exerciseKey = exKey;
    return pack;
  }
  async function whoami() {
    const out = {};
    try {
      const info = await request("GET", LOGIN + "/api/users/info");
      const data = info && typeof info.data === "object" ? info.data : info;
      out.user = {
        id: (data && (data.userId || data.id)) || null,
        name: (data && (data.nickname || data.name)) || null,
        phone: (data && data.phone) || null,
      };
    } catch (e) { out.user = null; }
    try {
      const cat = await request("GET", TIKU + "/activity/userexamcategory/getCurrent");
      const data = (cat || {}).data || {};
      out.examCategory = { id: data.examCategoryId, name: data.name, path: data.path, currentCourse: data.currentCourse };
    } catch (e) { out.examCategory = null; }
    return out;
  }

  /* ---------------- 云端错题同步 ---------------- */
  async function listWrongKeypointTree(prefix, timeRange, order) {
    const data = await request("GET",
      TIKU + "/api/" + prefix + "/errors/keypoint-tree?timeRange=" + timeRange + "&order=" + order);
    return Array.isArray(data) ? data : [];
  }
  async function solutionsByQuestionIds(prefix, questionIds, solType, chunkSize) {
    solType = solType || 1; chunkSize = chunkSize || 50;
    const ids = questionIds.map(function (x) { return parseInt(x, 10); })
      .filter(function (x) { return !isNaN(x); });
    const materials = [], solutions = [];
    let skipped = 0;
    async function fetchPart(part) {
      const url = TIKU + "/api/" + prefix + "/universal/auth/solutions?type=" + solType +
        "&questionIds=" + part.join(",") + "&routecs=" + prefix;
      try {
        const resp = await CapHttp().request({
          url: url, method: "GET",
          headers: { "User-Agent": UA, Cookie: getCookie(), Accept: "application/json" },
        });
        if (resp.status === 401) throw new FenbiAuthError("登录已过期，请重新扫码登录。");
        if (resp.status === 403) return ["forbidden", null];
        if (resp.status !== 200) return ["error", resp.status];
        let payload = resp.data;
        if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch (e) { return ["error", "bad-json"]; } }
        return ["ok", payload];
      } catch (e) {
        if (e instanceof FenbiAuthError) throw e;
        throw new FenbiError("网络请求失败：" + url + " (" + (e && e.message || e) + ")");
      }
    }
    async function handle(part) {
      const r = await fetchPart(part);
      const status = r[0], payload = r[1];
      if (status === "ok") {
        (payload.materials || []).forEach(function (m) { materials.push(m); });
        (payload.solutions || []).forEach(function (s) { solutions.push(s); });
        return;
      }
      if (status === "forbidden" && part.length > 1) {
        const mid = Math.floor(part.length / 2);
        await handle(part.slice(0, mid));
        await handle(part.slice(mid));
        return;
      }
      if (status === "forbidden") skipped += 1;
    }
    for (let i = 0; i < ids.length; i += chunkSize)
      await handle(ids.slice(i, i + chunkSize));
    return { materials: materials, solutions: solutions, skipped: skipped };
  }
  async function questionsBrief(prefix, questionIds, chunkSize) {
    /* 按数字题 ID 批量取题目简要信息（难度 difficulty 等），失败批次跳过。 */
    chunkSize = chunkSize || 50;
    const ids = (questionIds || []).map(function (x) { return parseInt(x, 10); })
      .filter(function (x) { return !isNaN(x); });
    const out = {};
    for (let i = 0; i < ids.length; i += chunkSize) {
      const part = ids.slice(i, i + chunkSize);
      try {
        let data = await request("GET",
          TIKU + "/api/" + prefix + "/questions?ids=" + part.join(","));
        if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { data = null; } }
        if (Array.isArray(data))
          data.forEach(function (q) {
            if (q && q.id !== undefined && q.id !== null) out[String(q.id)] = q;
          });
      } catch (e) { /* 单批失败不影响其余 */ }
    }
    return out;
  }
  async function buildWrongPlan(prefix) {
    const tree = await listWrongKeypointTree(prefix, 0, 0);
    const modules = [], q2module = {}, q2keypoint = {};
    for (const top of tree) {
      let name = top.name || "未分类";
      if (top.id === -1) name = "其他";
      const ids = Array.from(new Set((top.questionIds || []).map(function (x) { return parseInt(x, 10); })));
      modules.push({ name: name, ids: ids });
      ids.forEach(function (q) { q2module[q] = name; });
      for (const child of top.children || []) {
        const cname = child.name || "";
        for (const q of child.questionIds || []) {
          const qi = parseInt(q, 10);
          if (!(qi in q2keypoint)) q2keypoint[qi] = cname;
        }
      }
    }
    return [modules, q2module, q2keypoint];
  }
  async function syncWrong(prefix, moduleFilter, onProgress) {
    prefix = prefix || "xingce";
    const plan = await buildWrongPlan(prefix);
    const modules = plan[0], q2module = plan[1], q2keypoint = plan[2];
    let targets = [];
    if (moduleFilter) {
      for (const m of modules)
        if (m.name === moduleFilter) { targets = m.ids.slice(); break; }
      if (!targets.length) throw new FenbiError("云端没有“" + moduleFilter + "”模块。");
    } else {
      const seen = {};
      for (const m of modules)
        for (const q of m.ids)
          if (!seen[q]) { seen[q] = 1; targets.push(q); }
    }
    const total = targets.length;
    let newAdded = 0, contentN = 0, skipped = 0;
    if (onProgress) onProgress(0, total, "prepare");
    const chunkSize = 50;
    for (let i = 0; i < total; i += chunkSize) {
      const part = targets.slice(i, i + chunkSize);
      const pack = await solutionsByQuestionIds(prefix, part, 1, chunkSize);
      skipped += pack.skipped || 0;
      const matmap = {};
      for (const mm of pack.materials || [])
        if (mm.id !== null && mm.id !== undefined) matmap[parseInt(mm.id, 10)] = richToHtml(mm.content);
      const got = {};
      for (const s of pack.solutions || [])
        if (s.id !== null && s.id !== undefined) got[parseInt(s.id, 10)] = s;
      for (const q of part) {
        const modname = q2module[q] || "未分类";
        const kpname = q2keypoint[q] || "";
        const sol = got[q];
        let isNew;
        if (sol === undefined) {
          isNew = DB.upsertCloudWrong({
            global_id: String(q), question_id: String(q), prefix: prefix,
            module_name: modname, keypoint: kpname,
          });
        } else {
          let mref = sol.materialId;
          if (mref === null || mref === undefined) mref = sol.materialGlobalId;
          let materialHtml = "";
          if (mref !== null && mref !== undefined && String(mref).replace(/^-/, "").match(/^\d+$/) && matmap[parseInt(mref, 10)] !== undefined)
            materialHtml = matmap[parseInt(mref, 10)];
          else
            materialHtml = richToHtml(sol.material);
          let src = sol.shortSource;
          if (!src && typeof sol.source === "string") src = sol.source;
          isNew = DB.upsertCloudWrong({
            global_id: String(q), question_id: String(q), prefix: prefix,
            module_name: modname, keypoint: kpname,
            content_html: richToHtml(sol.content),
            options: extractOptionsHtml(sol.accessories),
            material_html: materialHtml,
            correct_answer: indexToLetter((sol.correctAnswer || {}).choice),
            analysis: richToHtml(sol.solution),
            source: src || "",
          });
          contentN += 1;
        }
        if (isNew) newAdded += 1;
      }
      if (onProgress) onProgress(Math.min(i + chunkSize, total), total, "sync");
    }
    return {
      total: total, newAdded: newAdded, contentFetched: contentN, skipped: skipped,
      cloudModules: modules.map(function (m) { return { name: m.name, count: m.ids.length }; }),
    };
  }

  window.Fenbi = {
    FenbiError: FenbiError, FenbiAuthError: FenbiAuthError,
    request: request, getCookie: getCookie, resetSession: resetSession,
    keypointTree: keypointTree, findModuleOfKeypoint: findModuleOfKeypoint,
    startKeypoint: startKeypoint, startPaper: startPaper, startSimilar: startSimilar,
    submitAndSolve: submitAndSolve, whoami: whoami, syncWrong: syncWrong,
    listLabels: listLabels, listPapers: listPapers,
    questionsBrief: questionsBrief, solutionsByQuestionIds: solutionsByQuestionIds,
    richToText: richToText, indexToLetter: indexToLetter, extractOptionsText: extractOptionsText,
    richToHtml: richToHtml, extractOptionsHtml: extractOptionsHtml,
    getExerciseMeta: getExerciseMeta, getContentByMeta: getContentByMeta,
    formatSolution: formatSolution, getSolutions: getSolutions,
  };
})();
