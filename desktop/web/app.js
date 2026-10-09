/* 上岸助手 · 前端逻辑（pywebview 桥） */
/* 注意：脚本加载时 window.pywebview 可能尚未注入，
   必须延迟到真正调用时再取，否则整文件会在加载期报错中断。 */
const api = new Proxy({}, {
  get: (_t, method) => (...args) => {
    const bridge = window.pywebview && window.pywebview.api;
    if (!bridge) {
      return Promise.reject(new Error("桌面桥接尚未就绪，请稍后再试。"));
    }
    return bridge[method](...args);
  },
});
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------- 基础工具 -------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function errText(e) {
  return (e && (e.message || e.msg)) || String(e);
}
function fmtHMS(sec) {
  sec = Math.max(0, Math.floor(sec));
  const p = (n) => String(n).padStart(2, "0");
  return `${p((sec / 3600) | 0)}:${p((sec / 60) % 60 | 0)}:${p(sec % 60)}`;
}
/* 填空横线：题面里的连续空格渲染为下划线占位 */
function blankify(s) {
  return esc(s).replace(/[\u00a0 ]{2,}/g, '<span class="q-blank"></span>');
}
/* 内容已是 HTML 时用：按标签切分，只处理文本段里的空白，不碰标签属性 */
function blankifyHtml(s) {
  s = String(s || "");
  if (!s.includes("<")) return blankify(s);
  return s.split(/(<[^>]*>)/g).map((seg) =>
    seg.startsWith("<") ? seg
      : seg.replace(/(?:&nbsp;|[\u00a0 ]){2,}/g, '<span class="q-blank"></span>')
  ).join("");
}
/* 难度星级（粉笔 difficulty 为 1-5） */
function stars(d) {
  const n = Math.max(1, Math.min(5, Math.round(Number(d) || 0)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}
/* 时间戳 → "9月28日 14:30" */
function fmtTs(ms) {
  if (!ms) return "";
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function letters(idxs) {
  return idxs.slice().sort((a, b) => a - b).map((i) => String.fromCharCode(65 + i)).join(",");
}
function setEqual(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/* ------------------------------------------------------- Toast ----------- */
function toast(title, text, kind = "info", ttl = 4200) {
  const icons = { ok: "✅", err: "⚠️", info: "ℹ️", reminder: "🔔" };
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="ti">${icons[kind] || "ℹ️"}</span>
    <div><b>${esc(title)}</b><p>${esc(text || "")}</p></div>`;
  $("toastWrap").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, ttl);
}

/* ------------------------------------------------------- 确认框 ---------- */
function askConfirm(title, text, okLabel = "确定") {
  return new Promise((resolve) => {
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmOk").textContent = okLabel;
    $("confirmMask").classList.add("on");
    const done = (v) => {
      $("confirmMask").classList.remove("on");
      okBtn.onclick = null; cancelBtn.onclick = null;
      resolve(v);
    };
    const okBtn = $("confirmOk"), cancelBtn = $("confirmCancel");
    okBtn.onclick = () => done(true);
    cancelBtn.onclick = () => done(false);
  });
}

/* ------------------------------------------------------- 全局状态 -------- */
const state = {
  init: null,
  screen: "practice",
  practice: {
    tab: "tree", tree: [], treeLoaded: false, expanded: new Set(),
    selNode: null, limit: 10, treeQuery: "",
    labels: [], papers: [], labelId: 1, paperPage: 0,
    session: null, review: null,
    history: [], histLoaded: false, weak: null,
  },
  wrong: { tab: "active", list: [], modules: [], sel: null, query: "",
    module: "", loaded: false, quiz: {}, excluded: {},
    dueMode: false, due: [], dueLoaded: false, sort: "due" },
  notes: { list: [], sel: null, query: "", preview: false },
  plan: { overview: null, tasks: [],
    focus: { running: false, elapsed: 0, last: 0, int: null } },
  report: { period: "week", data: null, review: "" },
  settings: null,
  connect: { tab: "scan", waiting: false },
  chat: { open: false, msgs: [], busy: false },
};

/* ------------------------------------------------------- 顶栏 ------------ */
function updateTop() {
  const g = state.init.general, c = state.init.counts;
  $("modelName").textContent = state.init.model.model || "未配置模型";
  $("modelChip").classList.toggle("on", !!state.init.model.api_key_set);
  const target = g.daily_target || 60;
  const done = Math.min(target, c.todayQuestions);
  const reached = done >= target;
  $("topRingText").textContent = `${done}/${target}`;
  $("topRing").classList.toggle("ok", reached);
  $("topRing").style.background = reached
    ? `conic-gradient(var(--green) 100%, #eef0f5 0)`
    : `conic-gradient(var(--blue) ${(done / target) * 100}%, #eef0f5 0)`;
  $("topFlame").textContent = c.streak >= 7 ? `✨🔥${c.streak}天` : `🔥${c.streak}`;
}

/* ------------------------------------------------------- 路由 ------------ */
async function go(screen) {
  state.screen = screen;
  document.querySelectorAll(".rail button").forEach((b) =>
    b.classList.toggle("on", b.dataset.s === screen));
  await render();
}

async function render() {
  const s = state.screen;
  $("listPane").style.display = "";
  /* 手机端做题/回看解析/错题详情时进入全屏模式（android.css 据此铺满） */
  document.body.classList.toggle("focus-mode",
    (s === "practice" && !!(state.practice.session || state.practice.review)) ||
    (s === "wrong" && !!state.wrong.sel));
  const views = {
    practice: renderPractice, wrong: renderWrong, notes: renderNotes,
    plan: renderPlan, report: renderReport, settings: renderSettings,
  };
  await views[s]();
  /* 重新触发淡入动画，让每次切页都有轻反馈 */
  const mp = $("mainPane");
  mp.style.animation = "none"; void mp.offsetWidth; mp.style.animation = "";
}

/* #####################################################################
   刷题
##################################################################### */
async function renderPractice() {
  const p = state.practice;
  $("crumb").innerHTML = `行测 / <b>${(!p.session && !p.review && p.tab === "history") ? "练习历史" :
      p.session ? p.session.name :
      p.selNode ? p.selNode.name : "选择练习内容"}</b>`;
  if (p.review) return renderReview();
  if (p.session) return renderSession();
  if (p.tab === "history") { renderHistoryTab(); return; }
  renderStartMain();

  if (p.tab === "tree") {
    $("listPane").innerHTML = `
      <input class="search" id="treeSearch" data-input="treeSearch" placeholder="搜索知识点" value="${esc(p.treeQuery)}">
      <div class="mini-seg">
        <span class="on">知识点</span><span data-act="ptab" data-v="paper">整卷</span><span data-act="ptab" data-v="history">历史</span>
      </div>
      <div id="treeBox"></div>`;
    if (!p.treeLoaded) {
      $("treeBox").innerHTML = `<div class="muted" style="padding:10px 6px;display:flex;align-items:center;gap:8px"><span class="typing"><i></i><i></i><i></i></span>正在加载知识点…</div>`;
      try {
        p.tree = await api.fenbi_keypoints(false);
        p.treeLoaded = true;
      } catch (e) {
        $("treeBox").innerHTML = `<div class="empty-state">
          <span class="big">🔌</span>
          ${state.init.cookieSet ? "知识点加载失败：" + esc(errText(e)) : "还没连接粉笔账号"}
          <br><br><button class="btn pri sm" data-act="go" data-v="settings">去登录粉笔账号</button></div>`;
        return;
      }
    }
    renderTreeBox();
  } else {
    renderPaperTab();
  }
}

function flattenLeaves(nodes, path = [], out = []) {
  for (const n of nodes) {
    const here = [...path, n.name];
    if (n.children && n.children.length) flattenLeaves(n.children, here, out);
    else out.push({ node: n, path: here.slice(0, -1) });
  }
  return out;
}

function renderTreeBox() {
  const p = state.practice;
  const box = $("treeBox");
  if (p.treeQuery.trim()) {
    const q = p.treeQuery.trim();
    const hits = flattenLeaves(p.tree).filter((x) => x.node.name.includes(q));
    box.innerHTML = hits.length ? hits.map((x) => `
      <div class="tree-label ${p.selNode && p.selNode.id === x.node.id ? "on" : ""}"
        data-act="selKp" data-id="${x.node.id}">
        <span class="leaf-dot"></span>${esc(x.node.name)}
        <span class="muted" style="margin-left:auto;font-size:10px">${esc(x.path.slice(-2).join(" / "))}</span>
      </div>`).join("") : `<p class="muted" style="padding:10px">未找到相关知识点</p>`;
    return;
  }
  box.innerHTML = p.tree.map((n) => treeNodeHtml(n, [])).join("");
}

function treeNodeHtml(n, path) {
  const p = state.practice;
  const hasKids = n.children && n.children.length;
  const open = p.expanded.has(n.id);
  const sel = p.selNode && p.selNode.id === n.id;
  const here = [...path, n.name];
  return `<div class="tree-node ${open ? "open" : ""}">
    <div class="tree-label ${sel ? "on" : ""}">
      <span class="arrow" ${hasKids ? `data-act="treeToggle" data-id="${n.id}"` : ""}>
        ${hasKids ? "▶" : ""}</span>
      <span data-act="selKp" data-id="${n.id}" style="flex:1">${esc(n.name)}</span>
      ${n.count != null ? `<span class="muted" style="font-size:10px">${n.count}</span>` : ""}
    </div>
    ${hasKids ? `<div class="tree-children">${n.children.map((c) =>
      treeNodeHtml(c, here)).join("")}</div>` : ""}
  </div>`;
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (String(n.id) === String(id)) return n;
    const hit = findNode(n.children || [], id);
    if (hit) return hit;
  }
  return null;
}

function renderStartMain() {
  const p = state.practice;
  if (!p.selNode) { renderWeakCard(); return; }
  const n = p.selNode;
  $("mainPane").innerHTML = `
    <div class="card start-card">
      <div class="big-title">${esc(n.name)}</div>
      <p class="muted">专项智能练习 · 由粉笔题库出题</p>
      <div class="choice-row">
        ${[5, 10, 15, 20].map((l) =>
          `<span data-act="lim" data-v="${l}" class="${p.limit === l ? "on" : ""}">${l} 题</span>`).join("")}
      </div>
      <div class="row">
        <button class="btn pri" id="startBtn" data-act="startKp" data-id="${n.id}">开始练习</button>
        <span class="muted">交卷后可查看粉笔解析与 AI 讲解</span>
      </div>
    </div>`;
}

/* 今日推荐：到期错题复习 + 薄弱点特训（按本地作答正确率定位） */
async function renderWeakCard() {
  const p = state.practice;
  let due = [];
  try { due = await api.wrong_due_list(200) || []; } catch (e) { /* 未同步错题时静默 */ }
  let weak = [];
  try { weak = await api.weak_points(3) || []; } catch (e) { weak = []; }
  p.weak = weak;
  if (!due.length && !weak.length) {
    $("mainPane").innerHTML = `<div class="empty-state">
      <span class="big">📚</span>从左侧选择一个知识点开始练习<br>
      <span style="font-size:12px">支持按知识点专项练习，答完自动出解析、记录错题</span></div>`;
    return;
  }
  const dueHtml = due.length
    ? `<div class="weak-due"><span>🕐 错题复习 · <b>${due.length}</b> 题今天到期（艾宾浩斯安排）</span>
       <button class="btn pri sm" data-act="goReviewDue">去复习</button></div>`
    : `<div class="weak-due ok"><span>✅ 今日到期错题已清完，复习节奏保持得不错</span></div>`;
  const RANKS = [
    { bg: "#eef3ff", fg: "#2f6bff" },
    { bg: "#fff7ed", fg: "#f59e0b" },
    { bg: "#fef2f2", fg: "#ef4444" },
  ];
  const weakHtml = weak.length ? `
    <div class="pane-title" style="margin-top:14px">薄弱点特训 · 最快提分</div>
    ${weak.map((k, i) => `
      <div class="weak-item">
        <span class="rk" style="background:${RANKS[i % RANKS.length].bg};color:${RANKS[i % RANKS.length].fg}">${i + 1}</span>
        <span class="tx"><b>${esc(k.keypoint)}</b>
          <span class="muted" style="font-size:11px">${esc(k.moduleName || "未分类")} · 个人正确率 ${k.accuracy}%（${k.attempts} 次作答${k.wrongCount ? `，错 ${k.wrongCount} 题` : ""}）</span></span>
        <button class="btn pri sm" data-act="weakTrain" data-kp="${esc(k.keypoint)}" data-mod="${esc(k.moduleName || "")}">特训 5 题 →</button>
      </div>`).join("")}`
    : `<p class="muted" style="margin-top:12px;font-size:12px">每个考点作答满 4 次后，这里会自动定位你的薄弱知识点</p>`;
  $("mainPane").innerHTML = `
    <div class="card start-card">
      <div class="big-title">今日推荐</div>
      <p class="muted" style="margin-bottom:4px">系统按你的作答数据选最快提分的题</p>
      ${dueHtml}
      ${weakHtml}
    </div>`;
}

/* ---------------------------- 练习历史 ------------------------- */
async function renderHistoryTab() {
  const p = state.practice;
  $("listPane").innerHTML = `
    <div class="mini-seg">
      <span data-act="ptab" data-v="tree">知识点</span><span data-act="ptab" data-v="paper">整卷</span><span class="on">历史</span>
    </div>
    <div id="histBox" style="margin-top:10px"></div>`;
  $("mainPane").innerHTML = `<div class="empty-state">
    <span class="big">🗂</span>从左侧选择一场已完成的练习<br>
    <span style="font-size:12px">可回看当时的题目、正确答案与解析</span></div>`;
  const box = $("histBox");
  if (!p.histLoaded) {
    box.innerHTML = `<p class="muted" style="padding:10px">加载练习历史…</p>`;
    try {
      p.history = await api.practice_history(100);
      p.histLoaded = true;
    } catch (e) {
      box.innerHTML = `<p class="muted" style="padding:10px">加载失败：${esc(errText(e))}</p>`;
      return;
    }
  }
  if (!p.history.length) {
    box.innerHTML = `<p class="muted" style="padding:10px">还没有练习记录，先去做一组题吧</p>`;
    return;
  }
  box.innerHTML = p.history.map((h) => {
    const acc = h.total_count ? Math.round(h.correct_count * 100 / h.total_count) : 0;
    const kindLabel = h.kind === "paper" ? "整卷" : "专项";
    return `<div class="tree-label" data-act="histOpen" data-id="${h.id}">
      <span class="leaf-dot"></span>
      <span style="flex:1;min-width:0">
        <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.source_name || "练习")}</span>
        <span class="muted" style="font-size:10px">${kindLabel} · ${fmtTs(h.finished_at)}</span>
      </span>
      <span class="muted" style="font-size:10px;text-align:right;line-height:1.5">
        ${h.correct_count}/${h.total_count} · ${acc}%<br>${fmtHMS(h.duration_sec)}</span>
    </div>`;
  }).join("");
}

/* ---------------------------- 整卷 ---------------------------- */
async function renderPaperTab() {
  const p = state.practice;
  $("listPane").innerHTML = `
    <div class="mini-seg">
      <span data-act="ptab" data-v="tree">知识点</span><span class="on">整卷</span><span data-act="ptab" data-v="history">历史</span>
    </div>
    <select class="field-input" data-input="labelSel" id="labelSel"></select>
    <div id="paperBox" style="margin-top:10px"></div>
    <div class="row" style="justify-content:center;margin-top:6px">
      <button class="btn sm" data-act="paperPage" data-v="-1">上一页</button>
      <span class="muted" id="paperPageInfo"></span>
      <button class="btn sm" data-act="paperPage" data-v="1">下一页</button>
    </div>`;
  try {
    if (!p.labels.length) p.labels = await api.fenbi_labels();
    $("labelSel").innerHTML = p.labels.map((l) =>
      `<option value="${l.id}" ${l.id === p.labelId ? "selected" : ""}>${esc(l.name)}</option>`).join("");
    await loadPapers();
  } catch (e) {
    $("paperBox").innerHTML = `<div class="empty-state"><span class="big">🔌</span>${esc(errText(e))}</div>`;
  }
}

async function loadPapers() {
  const p = state.practice;
  $("paperBox").innerHTML = `<p class="muted" style="padding:8px">加载试卷中…</p>`;
  const data = await api.fenbi_papers(p.labelId, p.paperPage, 10, "");
  p.papers = data.papers || [];
  $("paperPageInfo").textContent = `${p.paperPage + 1}/${data.pageInfo.totalPage}`;
  $("paperBox").innerHTML = p.papers.map((pa) => `
    <div class="paper-item" data-act="startPaper" data-id="${pa.id}">
      <b>${esc(pa.name)}</b>
      <div class="meta"><span>${esc(pa.date || "")}</span>
        <span>难度 ${(pa.difficulty ?? "-")}</span><span>${pa.exerciseCount || 0} 人做过</span></div>
    </div>`).join("") || `<p class="muted" style="padding:8px">本页无试卷</p>`;
}

/* ---------------------------- 会话 ---------------------------- */
function beginSession(data) {
  const p = state.practice;
  p.session = {
    ...data, answers: {}, excluded: {}, multi: new Set(), idx: 0,
    startedAt: Date.now(), elapsed: 0, int: null,
  };
  p.session.int = setInterval(() => {
    const s = p.session;
    if (!s) return;
    s.elapsed = Date.now() - s.startedAt;
    const t = $("sessTimer");
    if (t) t.textContent = fmtHMS(s.elapsed / 1000);
  }, 500);
  render();
}

function renderSession() {
  const s = state.practice.session;
  const q = s.questions[s.idx];
  const answeredCount = Object.keys(s.answers).length;
  const gid = q.globalId;
  const sel = s.answers[gid] || [];
  const isMulti = s.multi.has(gid);

  $("crumb").innerHTML = `<b>${esc(s.name)}</b>`;
  $("mainPane").innerHTML = `
    <div class="sess-head">
      <b style="font-size:14px">${esc(s.name)}</b>
      <span class="tag blue">第 ${s.idx + 1} / ${s.questions.length} 题</span>
      <span class="tag gray">已答 ${answeredCount}</span>
      ${q.difficulty != null ? `<span class="tag gray">难度 ${stars(q.difficulty)}</span>` : ""}
      <div style="flex:1"></div>
      <span class="multi-toggle ${isMulti ? "on" : ""}" data-act="multi">多选模式</span>
      <span class="timer" id="sessTimer">${fmtHMS(s.elapsed / 1000)}</span>
    </div>
    <div class="progress"><i style="width:${(answeredCount / s.questions.length) * 100}%"></i></div>

    <div class="card" style="margin-top:12px">
      ${q.materialHtml ? `<div class="q-material">${blankifyHtml(q.materialHtml)}</div>` : ""}
      <div class="stem">${blankifyHtml(q.contentHtml)}</div>
      ${q.options.length ? q.options.map((o, i) => {
        const excl = (s.excluded[gid] || []).includes(i);
        return `<div class="opt ${sel.includes(i) ? "sel" : ""} ${excl ? "excluded" : ""}" data-act="pick" data-v="${i}" title="长按可排除该选项">
          <span class="k">${String.fromCharCode(65 + i)}</span><span>${o}</span></div>`;
      }).join("")
        : `<p class="muted">本题无选项，可直接在右侧询问小岸。</p>`}
      <div class="q-prog"><i style="--w:${((s.idx + 1) / s.questions.length) * 100}%"></i>
        <span>第 ${s.idx + 1} / ${s.questions.length} 题</span></div>
      <div class="q-dots">
        ${s.questions.map((qq, i) => `<i class="${s.answers[qq.globalId] ? "answered" : ""} ${i === s.idx ? "cur" : ""}"
          data-act="jump" data-v="${i}"></i>`).join("")}
      </div>
      <div class="sess-foot">
        <button class="btn" data-act="nav" data-v="-1" ${s.idx === 0 ? "disabled" : ""}>上一题</button>
        <button class="btn pri" data-act="nav" data-v="1" ${s.idx === s.questions.length - 1 ? "disabled" : ""}>下一题</button>
        <div style="flex:1"></div>
        <button class="btn ghost" data-act="askAi">问小岸</button>
        <button class="btn pri" id="submitBtn" data-act="submit">交卷</button>
      </div>
    </div>`;
}

/* ---------------------------- 交卷+回顾 ----------------------- */
async function doSubmit() {
  const p = state.practice, s = p.session;
  const unanswered = s.questions.filter((q) => !s.answers[q.globalId]);
  if (unanswered.length) {
    const ok = await askConfirm("还有题目未作答",
      `有 ${unanswered.length} 道题未作答，未作答将计为错误，确定交卷？`, "仍然交卷");
    if (!ok) return;
  }
  const btn = $("submitBtn");
  btn.disabled = true; btn.textContent = "交卷中…";
  const answers = s.questions
    .filter((q) => s.answers[q.globalId])
    .map((q) => ({ globalId: q.globalId, choice: letters(s.answers[q.globalId]) }));
  try {
    const res = await api.practice_submit({
      sessionId: s.sessionId, key: s.key, prefix: s.prefix,
      answers, durationSec: Math.round(s.elapsed / 1000), module: s.module || "",
    });
    clearInterval(s.int);
    p.session = null;
    p.review = res;
    const wrongN = res.total - res.correctCount;
    if (wrongN) toast("已完成练习", `${wrongN} 道错题已自动加入错题本`, "info");
    render();
  } catch (e) {
    btn.disabled = false; btn.textContent = "交卷";
    toast("交卷失败", errText(e), "err");
  }
}

function renderReview() {
  const p = state.practice, r = p.review;
  const acc = r.total ? Math.round(r.correctCount * 100 / r.total) : 0;
  $("crumb").innerHTML = `<b>${r.hist ? "历史解析" : "练习解析"}</b>`;
  $("listPane").innerHTML = `
    <div class="result-summary">
      <div class="big">${acc} 分</div>
      <p class="muted" style="margin-top:4px">正确 ${r.correctCount} / ${r.total} 题</p>
    </div>
    ${r.hist
      ? `<button class="btn pri" style="width:100%" data-act="histBack">返回历史列表</button>`
      : `<button class="btn pri" style="width:100%" data-act="reviewAgain">再练一组</button>`}`;
  $("mainPane").innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <h3 style="margin:0">${r.hist ? "历史解析 · " : "粉笔解析 · "}${esc(r.name)}</h3>
      <div style="flex:1"></div>
      ${r.hist
        ? `<button class="btn sm" data-act="histBack">返回历史列表</button>`
        : `<button class="btn sm" data-act="reviewAgain">返回选题</button>`}
    </div>
    ${r.items.map((it, i) => reviewItemHtml(it, i)).join("")}`;
}

function reviewItemHtml(it, i) {
  const mySet = new Set((it.myAnswer || "").split(",").filter(Boolean));
  const correctSet = new Set((it.correctAnswer || "").split(",").filter(Boolean));
  const notAns = it.hist ? "当时未作答" : "未作答";
  /* 优先用带图片的 HTML 版本（旧记录/降级时回退纯文本） */
  const hasHtml = !!(it.contentHtml || (it.optionsHtml && it.optionsHtml.length));
  const opts = (it.optionsHtml && it.optionsHtml.length) ? it.optionsHtml : (it.options || []);
  return `<div class="review-item" data-idx="${i}">
    <div class="review-head" data-act="revToggle">
      <span class="no">${i + 1}</span>
      <b>${it.correct ? "✅" : "❌"} ${blankify((it.question || "").slice(0, 46))}…</b>
      <span class="muted">${it.correct ? "" :
        (it.myAnswer ? "我的答案 " + esc(it.myAnswer) : notAns)}</span>
    </div>
    <div class="review-body">
      ${it.materialHtml ? `<div class="q-material">${blankifyHtml(it.materialHtml)}</div>`
        : (it.material ? `<div class="q-material">${blankify(it.material)}</div>` : "")}
      <div class="stem" style="font-size:14px">${hasHtml && it.contentHtml
        ? blankifyHtml(it.contentHtml) : blankify(it.question || "")}</div>
      <div class="q-meta-bar">
        ${it.difficulty != null ? `<span>难度 ${stars(it.difficulty)}</span>` : ""}
        ${it.localAttempts
          ? `<span>个人正确率 <b>${Math.round(it.localCorrect * 100 / it.localAttempts)}%</b>（${it.localAttempts} 次作答）</span>`
          : ""}
        ${it.keypoints.map((k) => `<span class="kp">${esc(k)}</span>`).join("")}
      </div>
      ${opts.map((o, j) => {
        const L = String.fromCharCode(65 + j);
        const cls = correctSet.has(L) ? "right" : mySet.has(L) ? "bad" : "";
        const body = (it.optionsHtml && it.optionsHtml.length) ? o : esc(o);
        return `<div class="opt ${cls}" style="cursor:default">
          <span class="k">${L}</span><span>${body}</span></div>`;
      }).join("")}
      <div class="analysis-box">
        <div class="t">${it.hist ? "题目解析" : "粉笔解析"}</div>
        <div class="ans-row">
          <span class="ans-badge ${it.correct ? "ok" : "no"}">正确答案 ${esc(it.correctAnswer) || "—"}</span>
          ${it.correct ? `<span class="ans-badge plain">回答正确 🎉</span>`
            : `<span class="ans-badge mine">${it.myAnswer ? "我的答案 " + esc(it.myAnswer) : notAns}</span>`}
        </div>
        ${it.correctAnswerText ? `<div class="muted" style="margin:6px 0">${esc(it.correctAnswerText)}</div>` : ""}
        <div style="margin-top:6px">${it.analysisHtml
          ? emphAnalysis(it.analysisHtml) : emphAnalysis(esc(it.analysis || ""))}</div>
        ${it.source ? `<div class="muted" style="margin-top:7px">出处：${esc(it.source)}</div>` : ""}
      </div>
      <button class="btn ghost sm" data-act="askAbout" data-id="${it.globalId}">问小岸这道题</button>
    </div>
  </div>`;
}

/* #####################################################################
   错题本
##################################################################### */
async function renderWrong() {
  const w = state.wrong;
  if (w.dueMode) return renderWrongDue();
  $("crumb").innerHTML = `错题本 / <b>${w.module || "全部"}</b>`;
  if (!w.loaded) {
    try {
      w.modules = await api.wrong_modules();
      w.list = await api.wrong_list(w.query, w.tab, w.module, w.sort);
      w.loaded = true;
    } catch (e) { toast("加载错题失败", errText(e), "err"); }
  }
  $("listPane").innerHTML = `
    <input class="search" data-input="wrongSearch" placeholder="搜索错题/考点" value="${esc(w.query)}">
    <div class="mini-seg">
      <span class="${w.tab === "active" ? "on" : ""}" data-act="wtab" data-v="active">待复习</span>
      <span class="${w.tab === "mastered" ? "on" : ""}" data-act="wtab" data-v="mastered">已掌握</span>
    </div>
    <div class="mini-seg" style="margin-top:6px">
      <span class="${w.sort !== "mastery" ? "on" : ""}" data-act="wsort" data-v="due">按复习时间</span>
      <span class="${w.sort === "mastery" ? "on" : ""}" data-act="wsort" data-v="mastery">按掌握度</span>
    </div>
    <div class="pane-title">模块筛选</div>
    <div class="wrong-item ${!w.module ? "on" : ""}" data-act="wmod" data-v="">
      <span class="ic" style="font-size:12px">全</span><span class="tx">全部错题</span></div>
    ${w.modules.map((m) => `<div class="wrong-item ${w.module === m.name ? "on" : ""}"
      data-act="wmod" data-v="${esc(m.name)}">
      <span class="ic" style="font-size:11px">${esc(m.name.slice(0, 2))}</span>
      <span class="tx">${esc(m.name)}</span>
      <span class="muted" style="font-size:10px">掌握${m.mastery ?? 0}%</span>
      <b class="muted">${m.count}</b></div>`).join("") ||
      `<p class="muted" style="padding:6px">暂无错题</p>`}
    <div class="pane-title">错题列表</div>
    ${w.list.map(wrongItemHtml).join("") || `<p class="muted" style="padding:6px">没有符合条件的错题</p>`}`;

  if (!w.sel && w.list.length) w.sel = w.list[0];
  renderWrongMain();
}

/* 错题列表条目（掌握度环按衰减后的当前值显示；到期复习用颜色标记 urgency） */
function wrongItemHtml(it) {
  const w = state.wrong;
  const pct = it.masteryEff ?? it.mastery ?? 0;
  const color = pct >= 70 ? "var(--green)" : pct >= 40 ? "var(--orange)" : "var(--red)";
  const now = new Date();
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  const dayStart = dayEnd - 86399999;
  let dueCls = "";
  if (it.next_review_at) {
    if (it.next_review_at < dayStart) dueCls = "due-over";
    else if (it.next_review_at <= dayEnd) dueCls = "due-today";
  }
  return `<div class="wrong-item ${dueCls} ${w.sel && w.sel.id === it.id ? "on" : ""}" data-act="wsel" data-id="${it.id}"
    ${dueCls ? `title="${dueCls === "due-over" ? "已过复习期，尽快安排" : "今天到期复习"}"` : ""}>
    <span class="mastery-ring" style="background:conic-gradient(${color} ${pct}%,#eef0f5 0)"
      title="${it.masteryEff != null && it.masteryEff !== it.mastery ? `复习时 ${it.mastery}%，当前 ${it.masteryEff}%` : `掌握度 ${pct}%`}">
      <i>${pct}%</i></span>
    <span class="tx" style="font-size:12px">${esc(stripHtml(it.content_html).slice(0, 22))}…</span>
  </div>`;
}

/* 今日到期复习模式：只显示艾宾浩斯到期的错题，逐题过完为止 */
async function renderWrongDue() {
  const w = state.wrong;
  if (!w.dueLoaded) {
    try { w.due = await api.wrong_due_list(200) || []; }
    catch (e) { toast("加载到期错题失败", errText(e), "err"); w.due = []; }
    w.dueLoaded = true;
  }
  w.list = w.due;
  $("crumb").innerHTML = `错题本 / <b>今日到期复习</b>`;
  $("listPane").innerHTML = `
    <button class="btn pri" style="width:100%" data-act="wDueExit">✓ 完成复习，返回错题本</button>
    <div class="pane-title" style="margin-top:10px">今日到期 ${w.due.length} 题</div>
    ${w.due.map(wrongItemHtml).join("") ||
      `<p class="muted" style="padding:6px">🎉 今日到期的错题都复习完了</p>`}`;
  if (!w.sel || !w.due.find((x) => x.id === w.sel.id)) w.sel = w.due[0] || null;
  renderWrongMain();
}

function stripHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
}

function renderWrongMain() {
  const w = state.wrong;
  if (!w.sel) {
    $("mainPane").innerHTML = `<div class="empty-state">
      <span class="big">🎉</span><div>${w.tab === "active" ? "还没有错题，去刷题吧" : "还没有已掌握的错题"}</div>
      <div class="row" style="justify-content:center;margin-top:16px">
        <button class="btn pri" data-act="wSync">☁ 从粉笔云端同步错题</button>
        <button class="btn" data-act="go" data-v="practice">✏️ 去刷题</button>
      </div>
    </div>`;
    return;
  }
  const it = w.sel;
  const idx = w.list.findIndex((x) => x.id === it.id);
  const pos = idx >= 0 ? idx + 1 : 1;
  const cache = w.quiz[it.id];
  const masteredView = w.tab === "mastered";
  const revealed = masteredView || !!cache;
  const correctSet = new Set((it.correct_answer || "").split(",").filter(Boolean));
  const pickedSet = new Set(cache && cache.picked ? [cache.picked] : []);

  const verdictHtml = !revealed ? "" : masteredView
    ? `<div class="quiz-verdict mastered">✓ 该题已标记为掌握，正确答案：${esc(it.correct_answer)}</div>`
    : cache.correct
      ? `<div class="quiz-verdict ok">✓ 回答正确！</div>`
      : `<div class="quiz-verdict no">✗ 回答错误，正确答案：${esc(it.correct_answer)}</div>`;

  $("mainPane").innerHTML = `
    <div class="card">
      <div class="row" style="margin-bottom:8px">
        <button class="btn ghost sm m-only" data-act="wBack">‹ 列表</button>
        <h3 style="margin:0">${esc(it.keypoint || "错题重做")}</h3>
        <div style="flex:1"></div>
        <span class="muted" style="font-size:12px">第 ${pos} / ${w.list.length} 题</span>
      </div>
      <div style="margin-bottom:6px">
        <span class="tag blue">${esc(it.module_name || "未分类")}</span>
        <span class="tag red">错 ${it.wrong_count} 次</span>
        <span class="tag orange">掌握度 ${it.masteryEff ?? it.mastery}%</span>
        ${it.nextReviewLabel && !masteredView ? `<span class="tag gray">${esc(it.nextReviewLabel)}</span>` : ""}
      </div>
      ${it.material_html ? `<div class="q-material">${it.material_html}</div>` : ""}
      <div class="stem" style="font-size:14px">${it.content_html}</div>
      ${(it.options || []).map((o, j) => {
        const L = String.fromCharCode(65 + j);
        const exList = state.wrong.excluded[it.id] || [];
        const excl = !revealed && exList.includes(L);
        let cls = "";
        if (revealed) {
          if (correctSet.has(L)) cls = "right";
          else if (pickedSet.has(L)) cls = "bad";
        }
        const clickable = revealed ? "" : `data-act="wPick" data-v="${L}"`;
        return `<div class="opt ${cls} ${excl ? "excluded" : ""} ${revealed ? "" : "click"}" ${clickable} ${revealed ? "" : 'title="长按可排除该选项"'}>
          <span class="k">${L}</span><span class="opt-body">${o}</span></div>`;
      }).join("")}
      ${verdictHtml}
      ${revealed ? `
      <div class="analysis-box">
        <div class="t">粉笔解析</div>
        <div class="ana-body">${emphAnalysis(it.analysis || "（暂无解析）")}</div>
        ${it.source ? `<div class="muted" style="margin-top:7px">${esc(it.source)}</div>` : ""}
      </div>` : `
      <div class="muted" style="font-size:12px;text-align:center;margin:12px 0 2px">
        👇 点击一个选项，查看答案与解析</div>`}
      <div class="row" style="margin-top:12px">
        <button class="btn ghost" data-act="wPrev" ${idx <= 0 ? "disabled" : ""}>上一题</button>
        <button class="btn ghost" data-act="wNext" ${idx < 0 || idx >= w.list.length - 1 ? "disabled" : ""}>下一题</button>
        <button class="btn ghost" data-act="wAsk">AI 再讲一遍</button>
        <div style="flex:1"></div>
        <button class="btn ghost" data-act="wSync">☁ 云端同步</button>
        ${masteredView
          ? `<button class="btn" data-act="wReactivate" data-id="${it.id}">重新加入错题</button>`
          : revealed
            ? (cache.correct
              ? `<button class="btn ghost" data-act="wJudge" data-v="master">已彻底掌握</button>
                 <button class="btn pri" data-act="wJudge" data-v="review">✓ 答对了，安排复习</button>`
              : `<button class="btn ghost" data-act="wJudge" data-v="master">✓ 已掌握</button>
                 <button class="btn pri" data-act="wJudge" data-v="fail">记住了，明天再战</button>`)
            : ""}
      </div>
    </div>`;
}

/* 判断是否掌握并自动进入下一题。kind: master / review(答对) / fail(答错) */
async function judgeAndGo(kind) {
  const w = state.wrong;
  const it = w.sel;
  if (!it) return;
  const idx = w.list.findIndex((x) => x.id === it.id);
  const nextIt = w.list[idx + 1] || w.list[idx - 1] || null;
  let r;
  try {
    r = await api.wrong_action(it.id, kind === "master" ? "master" : kind);
  } catch (e) { toast("操作失败", errText(e), "err"); return; }
  if (kind === "master") {
    toast("已掌握", "该题移出错题本", "ok");
    const nextId = nextIt ? nextIt.id : null;
    w.modules = await api.wrong_modules();
    if (w.dueMode) {
      w.due = w.due.filter((x) => x.id !== it.id);
      w.dueLoaded = true;
      w.sel = w.due.find((x) => x.id === nextId) || w.due[0] || null;
    } else {
      w.list = await api.wrong_list(w.query, w.tab, w.module, w.sort);
      w.sel = w.list.find((x) => x.id === nextId) || w.list[0] || null;
    }
    renderWrong();
  } else {
    it.mastery = r.mastery;
    it.masteryEff = r.mastery;
    it.nextReviewLabel = r.nextReviewLabel;
    toast(kind === "fail" ? "已安排明天再战" : "已记录",
      `下次复习：${r.nextReviewLabel}`, "ok");
    if (w.dueMode) {
      w.due = w.due.filter((x) => x.id !== it.id);
      w.sel = w.due.find((x) => x.id === (nextIt ? nextIt.id : null)) || w.due[0] || null;
      renderWrong();
    } else {
      w.sel = nextIt;
      renderWrong();
    }
  }
}

async function refreshWrong() {
  const w = state.wrong;
  const keepId = w.sel ? w.sel.id : null;
  w.modules = (await api.wrong_modules()) || [];
  w.list = (await api.wrong_list(w.query, w.tab, w.module, w.sort)) || [];
  w.sel = w.list.find((x) => x.id === keepId) || w.list[0] || null;
  renderWrong();
}

/* ----------------------------- 云端同步错题 ----------------------------- */
function openSyncMask() {
  let m = $("wrongSyncMask");
  if (!m) {
    m = document.createElement("div");
    m.id = "wrongSyncMask";
    m.className = "mask";
    m.innerHTML = `<div class="modal" style="width:380px;text-align:center;padding:26px">
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">正在从粉笔同步错题</div>
      <div id="wsPhase" class="muted" style="font-size:12px;margin-bottom:14px">准备中…</div>
      <div style="height:8px;border-radius:8px;background:#eef0f5;overflow:hidden">
        <div id="wsBar" style="height:100%;width:0%;background:var(--blue);transition:width .25s"></div>
      </div>
      <div id="wsNum" style="font-size:12px;margin-top:8px" class="muted">0 / 0</div>
    </div>`;
    document.body.appendChild(m);
  }
  $("wsBar").style.width = "0%";
  m.classList.add("on");
}

function updateSyncMask(p) {
  const bar = $("wsBar");
  if (!bar) return;
  const pct = p.total ? Math.round((p.done * 100) / p.total) : 0;
  bar.style.width = pct + "%";
  $("wsNum").textContent = `${p.done} / ${p.total}`;
  $("wsPhase").textContent =
    p.phase === "prepare" ? "正在读取云端错题结构…" : `正在下载题目与解析（${pct}%）`;
}

function closeSyncMask() {
  const m = $("wrongSyncMask");
  if (m) m.classList.remove("on");
}

async function syncWrongFromCloud(module = "") {
  const w = state.wrong;
  if (w.syncing) return;
  w.syncing = true;
  openSyncMask();
  try {
    const r = await api.wrong_sync({ prefix: "xingce", module });
    closeSyncMask();
    w.loaded = false;
    await refreshWrong();
    let msg = `共 ${r.total} 题，新增 ${r.newAdded} 题`;
    if (r.skipped) msg += `，${r.skipped} 题无权限已跳过`;
    toast("错题同步完成", msg, "ok");
  } catch (e) {
    closeSyncMask();
    toast("同步错题失败", errText(e), "err");
  } finally {
    w.syncing = false;
  }
}

/* #####################################################################
   笔记
##################################################################### */
async function renderNotes() {
  const n = state.notes;
  $("crumb").innerHTML = `笔记 / <b>${n.sel ? n.sel.title : "全部"}</b>`;
  try { n.list = (await api.notes_list(n.query)) || []; } catch (e) { toast("加载笔记失败", errText(e), "err"); }
  if (n.sel) n.sel = n.list.find((x) => x.id === n.sel.id) || null;

  $("listPane").innerHTML = `
    <input class="search" data-input="noteSearch" placeholder="搜索笔记" value="${esc(n.query)}">
    <button class="btn pri sm" style="width:100%;margin:10px 0" data-act="noteNew">＋ 新建笔记</button>
    ${n.list.map((t) => `<div class="note-item ${n.sel && n.sel.id === t.id ? "on" : ""}"
      data-act="noteSel" data-id="${t.id}">
      <span style="font-size:14px">📝</span>
      <span class="tx">${esc(t.title || "无标题")}</span></div>`).join("") ||
      `<p class="muted" style="padding:6px">还没有笔记</p>`}`;

  if (!n.sel) {
    $("mainPane").innerHTML = `<div class="empty-state">
      <span class="big">🗒</span>选择一篇笔记，或新建一篇<br>
      <span style="font-size:12px">支持 Markdown、关联错题、AI 润色</span></div>`;
    return;
  }
  const t = n.sel;
  $("mainPane").innerHTML = `
    <div class="card">
      <input class="field-input" id="noteTitle" data-input="noteField" style="font-size:15px;font-weight:700"
        value="${esc(t.title)}" placeholder="笔记标题">
      <div class="row" style="margin:10px 0">
        <input class="field-input" data-input="noteField" id="noteTags" value="${esc(t.tags)}"
          placeholder="标签（空格分隔）" style="flex:1">
        <input class="field-input" data-input="noteField" id="noteLink" value="${esc(t.linked_global)}"
          placeholder="关联题目 ID（可选）" style="width:200px">
      </div>
      <div class="row" style="margin-bottom:8px">
        <button class="btn sm ${n.preview ? "" : "pri"}" data-act="noteEdit">编辑</button>
        <button class="btn sm ${n.preview ? "pri" : ""}" data-act="notePreviewToggle">预览</button>
      </div>
      ${n.preview
        ? `<div class="note-preview">${md(t.body || "")}</div>`
        : `<textarea class="note-edit field-input" data-input="noteField" id="noteBody"
            placeholder="正文（支持 Markdown）">${esc(t.body)}</textarea>`}
      <div class="row" style="margin-top:12px">
        <button class="btn pri" data-act="noteSave" data-id="${t.id}">保存</button>
        <button class="btn ghost" data-act="noteAsk">让 AI 润色/出检测题</button>
        <button class="btn ghost" data-act="noteExportPdf" data-id="${t.id}">📄 导出 PDF</button>
        <div style="flex:1"></div>
        <button class="btn" data-act="noteDel" data-id="${t.id}">删除</button>
      </div>
    </div>`;
}

/* ---------------------------- Markdown ---------------------------------- */
function md(s) {
  const lines = String(s || "").replace(/\r/g, "")
    .replace(/<br\s*\/?>/gi, "\n").split("\n");
  let html = "", i = 0;
  const inline = (t) => {
    let out = esc(t);
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    out = out.replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>");
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) =>
      /^(https?:|mailto:)/i.test(url)
        ? `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`
        : txt);
    return out;
  };
  const splitCells = (row) => {
    let r = row.trim();
    if (r.startsWith("|")) r = r.slice(1);
    if (r.endsWith("|") && !r.endsWith("\\|")) r = r.slice(0, -1);
    return r.split("|").map((c) => c.trim());
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      html += `<pre><code>${esc(buf.join("\n"))}</code></pre>`; i++; continue;
    }
    /* 分隔线 */
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { html += "<hr>"; i++; continue; }
    /* GFM 表格 */
    if (line.includes("|") && i + 1 < lines.length
        && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])
        && lines[i + 1].includes("-")) {
      const head = splitCells(line);
      const aligns = splitCells(lines[i + 1]).map((a) =>
        /^:.*:$/.test(a) ? "center" : /:$/.test(a) ? "right" : /^:/.test(a) ? "left" : "");
      const rows = []; i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push(splitCells(lines[i++]));
      html += `<div class="md-table"><table><thead><tr>${head.map((c, k) =>
        `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ""}>${inline(c)}</th>`).join("")
      }</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) =>
        `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ""}>${inline(r[k] || "")}</td>`)
        .join("")}</tr>`).join("")}</tbody></table></div>`;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) { html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      html += `<blockquote>${inline(buf.join("<br>"))}</blockquote>`; continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      html += `<ul>${buf.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`; continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]))
        buf.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      html += `<ol>${buf.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`; continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim()
      && !/^(#{1,6}\s|```|>|\s*[-*]\s|\s*\d+\.\s|\s*([-*_])(\s*\1){2,}\s*$)/.test(lines[i])
      && !(lines[i].includes("|") && i + 1 < lines.length
           && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])))
      buf.push(lines[i++]);
    html += `<p>${inline(buf.join("<br>"))}</p>`;
  }
  return html;
}

/* #####################################################################
   计划
##################################################################### */
async function renderPlan() {
  const pl = state.plan;
  $("crumb").innerHTML = `计划任务 / <b>今天</b>`;
  try {
    pl.overview = await api.plan_overview(0);
    pl.tasks = await api.tasks_list("");
  } catch (e) { toast("加载计划失败", errText(e), "err"); }
  const ov = pl.overview;

  $("listPane").innerHTML = `
    ${ov.countdown ? `<div class="countdown">
        <small>距「${esc(ov.countdown.name)}」还有</small>
        <div class="n">${ov.countdown.days} 天</div></div>`
      : `<div class="countdown"><small>设置考试日期后显示倒计时</small><div class="n">—</div></div>`}
    <div class="pane-title">${esc(ov.monthLabel)} · 打卡日历</div>
    <div class="cal-grid">
      ${ov.cells.map((c) => c.empty ? `<i></i>`
        : `<i class="${c.checked ? "done" : ""} ${c.isToday ? "today" : ""}"><span>${c.day}</span></i>`).join("")}
    </div>
    <div class="pane-title" style="margin-top:22px">近 7 天学习（分钟）</div>
    <div class="bars">
      ${ov.bars.map((b) => `<i style="height:${Math.min(100, b.minutes / 2)}"><span>${b.label}</span></i>`).join("")}
    </div>`;

  const f = pl.focus;
  $("mainPane").innerHTML = `
    <div class="card">
      <div class="row">
        <h3 style="margin:0">今日任务</h3>
        <div style="flex:1"></div>
        <button class="btn ghost sm" data-act="aiTasks">✨ AI 生成今日任务</button>
      </div>
      <div class="row" style="margin:12px 0;gap:7px">
        <input class="field-input" id="newTaskTitle" placeholder="添加任务，如：资料分析速算 30 分钟" style="flex:1">
        <input class="field-input" id="newTaskMin" type="number" placeholder="分钟" style="width:80px">
        <button class="btn pri" data-act="addTask">添加</button>
      </div>
      ${pl.tasks.map((t) => `<div class="task ${t.status === "done" ? "done" : ""}">
        <span class="ck ${t.status === "done" ? "done" : ""}" data-act="taskToggle" data-id="${t.id}"></span>
        <div class="t-info"><b>${esc(t.title)}</b>
          <p>${t.source === "ai" ? "AI 安排 · " : ""}${esc(t.detail || "")} ${t.duration_min ? `· 约${t.duration_min}分钟` : ""} ${t.required ? "· 必做" : ""}</p></div>
        <span class="del" data-act="taskDel" data-id="${t.id}">✕</span>
      </div>`).join("") || `<p class="muted" style="padding:6px">今天还没有任务</p>`}
    </div>

    <div class="card">
      <h3>⏱ 专注计时</h3>
      <div class="focus-box">
        <span class="focus-time">${fmtHMS(f.elapsed / 1000)}</span>
        ${f.running
          ? `<button class="btn pri" data-act="focusPause">暂停</button>`
          : `<button class="btn pri" data-act="focusStart">开始</button>`}
        <button class="btn" data-act="focusReset">重置</button>
        <button class="btn ghost" data-act="focusSave">记录这段学习</button>
      </div>
      <p class="muted" style="margin-top:9px">记录的专注时长会计入学习报告，帮助统计每天投入。</p>
    </div>`;
}

/* #####################################################################
   学习报告
##################################################################### */
async function renderReport() {
  const r = state.report;
  $("crumb").innerHTML = `学习报告 / <b>${r.period}</b>`;
  $("listPane").innerHTML = `
    <div class="pane-title">报告周期</div>
    ${[["week","本周"],["last_week","上周"],["month","本月"]].map(([k, v]) =>
      `<div class="wrong-item ${r.period === k ? "on" : ""}" data-act="period" data-v="${k}">
        <span class="ic" style="font-size:11px">${v.slice(0,1)}</span>
        <span class="tx">${v}报告</span></div>`).join("")}
    <button class="btn pri" style="width:100%;margin-top:12px" data-act="openShare">📤 分享报告</button>`;

  if (!r.data) {
    $("mainPane").innerHTML = `<p class="muted" style="padding:20px">加载报告中…</p>`;
    try { r.data = await api.report_data(r.period); }
    catch (e) { toast("加载报告失败", errText(e), "err"); return; }
  }
  renderReportMain();
}

function renderReportMain() {
  const r = state.report, d = r.data;
  const col = (v) => v >= 75 ? "green" : v >= 60 ? "blue" : v >= 40 ? "orange" : "red";
  const maxTrend = Math.max(1, ...d.wrongTrend.map((x) => x.value));
  $("mainPane").innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="v blue">${d.questions}</div><div class="l">${esc(d.periodLabel)}刷题（道）</div></div>
      <div class="stat"><div class="v ${col(d.accuracy)}">${d.accuracy}%</div><div class="l">平均正确率</div></div>
      <div class="stat"><div class="v orange">${d.hours}h</div><div class="l">学习时长</div></div>
      <div class="stat"><div class="v red">${d.streak}天</div><div class="l">连续打卡</div></div>
    </div>

    <div class="card" style="margin-top:13px">
      <h3>📊 各模块正确率</h3>
      ${d.modules.length ? d.modules.map((m) => `
        <div class="rate-row"><span class="name">${esc(m.name)}</span>
          <span class="track"><i style="width:${m.accuracy}%;background:var(--${col(m.accuracy) === "green" ? "green" : col(m.accuracy) === "red" ? "orange" : "blue"})"></i></span>
          <span class="val">${m.accuracy}%</span></div>`).join("")
        : `<p class="muted">暂无数据，完成练习后自动统计</p>`}
    </div>

    <div class="card">
      <h3>📉 近 8 周每周错题数</h3>
      <div class="trend" style="margin-top:14px">
        ${d.wrongTrend.map((w, i) => `<i style="height:${Math.max(3, w.value / maxTrend * 100)}%;
          background:${i >= 5 ? "var(--green)" : i >= 3 ? "#93c5fd" : "#fca5a5"}">
          <span>${esc(w.label)}</span></i>`).join("")}
      </div>
    </div>

    <div class="card">
      <div class="row"><h3 style="margin:0">🧠 AI 点评</h3>
        <div style="flex:1"></div>
        <button class="btn ghost sm" data-act="aiReport">${r.review ? "重新生成" : "生成点评"}</button></div>
      ${r.review ? `<div class="ai-review" style="margin-top:10px"><span class="bot-ava">岸</span><div>${md(r.review)}</div></div>`
        : `<p class="muted" style="padding:6px">点击“生成点评”，小岸会根据你的真实数据给出下周建议（需配置模型）。</p>`}
    </div>

    <div class="row">
      <button class="btn pri" data-act="openShare">📤 分享学习报告</button>
    </div>`;
}

/* #####################################################################
   设置
##################################################################### */
const PROVIDERS = [
  ["DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat"],
  ["OpenAI", "https://api.openai.com/v1", "gpt-4o-mini"],
  ["智谱GLM", "https://open.bigmodel.cn/api/paas/v4", "glm-4-flash"],
  ["通义千问", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"],
  ["Kimi", "https://api.moonshot.cn/v1", "moonshot-v1-8k"],
  ["自定义", "", ""],
];

async function renderSettings() {
  $("crumb").innerHTML = `<b>设置</b>`;
  $("listPane").style.display = "none";
  const m = state.init.model, g = state.init.general;
  $("mainPane").innerHTML = `
  <div style="max-width:660px;margin:0 auto">
    <div class="card">
      <h3>🤖 AI 模型</h3>
      <div class="field" style="margin-bottom:12px"><label style="display:block;font-size:12px;color:var(--sub);margin-bottom:5px">服务商</label>
        <select class="field-input" id="setProvider">
          ${PROVIDERS.map((p) => `<option ${p[0] === m.provider ? "selected" : ""}>${p[0]}</option>`).join("")}
        </select></div>
      <div class="field"><label style="display:block;font-size:12px;color:var(--sub);margin-bottom:5px">API Base URL</label>
        <input class="field-input" id="setBase" value="${esc(m.base_url)}"></div>
      <div class="row" style="margin:12px 0">
        <div style="flex:1"><label style="display:block;font-size:12px;color:var(--sub);margin-bottom:5px">API Key</label>
          <input class="field-input" id="setKey" type="password" value="${esc(m.api_key)}"></div>
        <div style="width:170px"><label style="display:block;font-size:12px;color:var(--sub);margin-bottom:5px">模型名</label>
          <input class="field-input" id="setModelName" value="${esc(m.model)}"></div></div>
      <div class="field"><label style="display:block;font-size:12px;color:var(--sub);margin-bottom:5px">
        创造性：${m.temperature}</label>
        <input type="range" id="setTemp" min="0" max="100" value="${Math.round(m.temperature * 100)}" style="width:100%"></div>
      <div class="row">
        <button class="btn" data-act="modelTest">测试连接</button>
        <button class="btn pri" data-act="modelSave">保存</button>
        <div style="flex:1"></div><span class="muted" id="modelStatus"></span></div>
    </div>

    <div class="card">
      <h3>📚 粉笔账号</h3>
      <p class="muted" style="margin-bottom:10px">推荐使用网页登录：弹出粉笔官方页面扫码或手机号登录，登录成功后自动完成连接。</p>
      <div class="row" style="margin-bottom:6px">
        <button class="btn pri" data-act="settingsOpenLogin">🟢 扫码 / 网页登录</button>
        ${state.init.cookieSet
          ? `<button class="btn danger" data-act="fenbiLogout">退出登录</button>` : ""}
        <span class="muted" id="cookieStatus">${state.init.cookieSet ? "当前已连接" : "未连接"}</span></div>
      <details style="margin-top:8px">
        <summary class="muted" style="font-size:12px;cursor:pointer">手动粘贴 Cookie（备用方式）</summary>
        <p class="muted" style="margin:8px 0 6px;font-size:12px">从已登录粉笔的浏览器复制 Cookie（F12 → Network → 请求头）。</p>
        <textarea class="field-input" id="setCookie" rows="3" placeholder="粘贴整段 Cookie"></textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn" data-act="cookieSave">保存并验证</button></div>
      </details>
    </div>

    <div class="card">
      <h3>🎯 考试与督学</h3>
      <div class="row" style="margin-bottom:11px">
        <div style="flex:1"><label style="display:block;font-size:12px;color:var(--sub);margin-bottom:5px">考试名称</label>
          <input class="field-input" id="setExamName" value="${esc(g.exam_name)}"></div>
        <div style="width:170px"><label style="display:block;font-size:12px;color:var(--sub);margin-bottom:5px">考试日期</label>
          <input class="field-input" id="setExamDate" type="date" value="${esc(g.exam_date)}"></div></div>
      <div class="row" style="margin-bottom:11px">
        <div style="flex:1"><label style="display:block;font-size:12px;color:var(--sub);margin-bottom:5px">每日题量目标</label>
          <input class="field-input" id="setTarget" type="number" value="${g.daily_target}"></div>
        <div style="width:170px"><label style="display:block;font-size:12px;color:var(--sub);margin-bottom:5px">提醒时间</label>
          <input class="field-input" id="setRemind" type="time" value="${esc(g.reminder_time)}"></div></div>
      <label style="font-size:12.5px"><input type="checkbox" id="setStrict" ${g.strict_mode ? "checked" : ""}>
        严格模式（到点未完成，小岸主动提醒谈话）</label>
      <div class="row" style="margin-top:11px"><button class="btn pri" data-act="generalSave">保存考试与督学设置</button></div>
    </div>

    <div class="card">
      <h3>🎨 护眼背景</h3>
      <p class="muted" style="margin-bottom:10px">做题面板的底色，选一个看着舒服的，点击立即生效。</p>
      <div class="bg-opts">
        <div class="bg-opt ${((state.init.general.bg_mode) || "default") === "default" ? "on" : ""}"
          data-act="bgSet" data-v="default"><i style="background:#ffffff"></i>默认</div>
        <div class="bg-opt ${state.init.general.bg_mode === "blue" ? "on" : ""}"
          data-act="bgSet" data-v="blue"><i style="background:#dbe9fd"></i>蓝色</div>
        <div class="bg-opt ${state.init.general.bg_mode === "green" ? "on" : ""}"
          data-act="bgSet" data-v="green"><i style="background:#d9eddc"></i>绿色</div>
        <div class="bg-opt ${state.init.general.bg_mode === "red" ? "on" : ""}"
          data-act="bgSet" data-v="red"><i style="background:#fce4e2"></i>红色</div>
      </div>
    </div>

    <div class="card">
      <h3>💾 数据备份</h3>
      <p class="muted" style="margin-bottom:10px">错题、笔记、计划均保存在本机。</p>
      <button class="btn" data-act="backupExport">导出备份</button>
      <button class="btn" data-act="backupImport">从备份恢复</button></div>
  </div>`;
}

function readModelForm() {
  return {
    provider: $("setProvider").value,
    base_url: $("setBase").value.trim(),
    api_key: $("setKey").value.trim(),
    model: $("setModelName").value.trim(),
    temperature: Number(($("setTemp").value || 30)) / 100,
  };
}

/* #####################################################################
   首次进入 · 连接粉笔账号
##################################################################### */
function openConnect() {
  renderConnect();
  $("connectMask").classList.add("on");
}

function renderConnect() {
  const c = state.connect;
  $("connectMask").querySelectorAll(".connect-tabs span").forEach((s) =>
    s.classList.toggle("on", s.dataset.v === c.tab));

  if (c.tab === "cookie") {
    $("connectBody").innerHTML = `
      <ol class="connect-steps">
        <li>电脑浏览器打开粉笔官网并登录；</li>
        <li>按 F12 → Network（网络）→ 点任意请求；</li>
        <li>复制请求头里整段 Cookie，粘贴到下面。</li>
      </ol>
      <textarea class="field-input" id="connectCookieText" rows="4"
        placeholder="userid=...; sid=...; （整段粘贴）"></textarea>
      <button class="btn pri" style="width:100%;margin-top:12px"
        data-act="connectCookie">保存并验证</button>
      <p class="muted" style="font-size:12px;text-align:center;margin:10px 0 0">
        <span data-act="connectSkip" style="cursor:pointer;text-decoration:underline">稍后连接，先看看</span></p>`;
  } else if (c.waiting) {
    $("connectBody").innerHTML = `
      <div class="login-waiting">
        <div class="lw-title"><span class="lw-spinner"></span>正在等待登录…</div>
        <p>请在弹出的粉笔页面中点击登录，用<b>粉笔 App 扫码</b>或手机号验证；<br>
          登录成功后会自动获取并完成连接，无需复制任何内容。</p>
      </div>
      <button class="btn" style="width:100%" data-act="connectFinish">未自动识别？点此立即获取一次</button>
      <button class="btn sm" style="width:100%;margin-top:8px" data-act="debugCookie">🧪 查看当前浏览器实际 Cookie</button>
      <div id="debugBox" class="muted" style="display:none;margin-top:8px;padding:10px;background:#f7f9fd;border-radius:8px;
        font-size:11.5px;max-height:130px;overflow:auto;white-space:pre-wrap;word-break:break-all"></div>
      <p class="muted" style="font-size:12px;text-align:center;margin:10px 0 0">
        <span data-act="connectCancel" style="cursor:pointer;text-decoration:underline">取消等待</span></p>`;
  } else {
    $("connectBody").innerHTML = `
      <div class="scan-steps">
        <p>① 点击下方按钮，弹出粉笔官方页面；</p>
        <p>② 在页面里点登录，用<b>粉笔 App 扫码</b>或手机号登录；</p>
        <p>③ 登录成功后<b>自动识别并连接</b>，不用复制任何内容。</p>
      </div>
      <button class="btn pri" style="width:100%" data-act="connectOpenPage">
        🟢 打开粉笔登录页（扫码 / 手机号）</button>
      <p class="muted" style="font-size:12px;text-align:center;margin:10px 0 0">
        <span data-act="connectSkip" style="cursor:pointer;text-decoration:underline">稍后连接，先看看</span></p>`;
  }
}

async function afterConnected() {
  state.connect.waiting = false;
  state.init.cookieSet = true;
  /* 强制下次重新从已登录账号拉取知识点树 */
  state.practice.treeLoaded = false;
  state.practice.tree = [];
  state.practice.selNode = null;
  $("connectMask").classList.remove("on");
  await go("practice");
}

/* #####################################################################
   分享弹窗
##################################################################### */
let shareLocal = null;

function openShareModal() {
  shareLocal = {
    img: "",
    privacy: { ...state.init.privacy },
  };
  $("shareBody").innerHTML = shareLayoutHtml();
  $("shareMask").classList.add("on");
}

function shareLayoutHtml() {
  const pr = shareLocal.privacy;
  return `
  <div class="share-layout">
    <div class="poster-preview" id="posterPreview">
      <span class="muted">点击右侧<br>“生成海报”预览</span></div>
    <div class="share-side">
      <div class="row" style="margin-bottom:10px">
        <h4 style="margin:0">报告海报</h4><div style="flex:1"></div>
        <button class="btn pri sm" data-act="posterGen">生成海报</button></div>
      <div class="share-hint">桌面端无法直接代发微信/小红书：保存海报图片后，在对应 App 中粘贴图片即可分享。</div>
      <h4>隐私设置</h4>
      <div class="privacy">
        <div class="p-row"><span>隐藏昵称（匿名考生）</span>
          <span class="switch ${pr.anonymous ? "on" : ""}" data-act="pSw" data-v="anonymous"></span></div>
        <div class="p-row"><span>隐藏手机号/岗位</span>
          <span class="switch ${pr.hide_phone ? "on" : ""}" data-act="pSw" data-v="hide_phone"></span></div>
        <div class="p-row"><span>仅展示本周</span>
          <span class="switch ${pr.current_only ? "on" : ""}" data-act="pSw" data-v="current_only"></span></div>
      </div>
      <button class="btn pri" style="width:100%" data-act="posterSave">💾 保存海报（可发微信/朋友圈）</button>
    </div>
  </div>`;
}

async function posterGenerate() {
  try {
    const res = await api.share_generate(state.report.period, shareLocal.privacy);
    shareLocal.img = res.dataUrl;
    $("posterPreview").innerHTML = `<img src="${res.dataUrl}" alt="报告海报">`;
  } catch (e) { toast("生成海报失败", errText(e), "err"); }
}

async function posterSave() {
  try {
    if (!shareLocal.img) await posterGenerate();
    const res = await api.share_save("保存海报");
    if (res && !res.cancelled) {
      toast("海报已保存", res.path, "ok");
      $("shareMask").classList.remove("on");
    }
  } catch (e) { toast("保存失败", errText(e), "err"); }
}

/* #####################################################################
   悬浮 AI 对话
##################################################################### */
async function loadChat() {
  try { state.chat.msgs = await api.chat_history(30); }
  catch (e) { /* 静默 */ }
  renderChat();
}

function renderChat() {
  const c = state.chat;
  $("floatChat").innerHTML = `
    <div class="chat-head">
      <span class="bot-ava">岸</span>
      <div><b style="font-size:13px">小岸 · AI 辅导</b>
      <div class="muted" id="chatCtxLabel">随时可以问我</div></div>
      <button class="min-btn" data-act="chatMin">—</button>
    </div>
    <div class="chat-body" id="chatBody">
      ${c.msgs.length ? c.msgs.map(chatMsgHtml).join("")
        : `<div class="msg bot">你好，我是小岸 👋 刷题、错题分析、计划安排都可以找我。</div>`}
    </div>
    <div id="chatQuicks" style="padding:0 13px"></div>
    <div class="chat-input">
      <div class="box">
        <input id="chatText" placeholder="输入消息，回车发送…">
        <span data-act="chatSend" style="cursor:pointer">➤</span></div>
    </div>`;
  renderQuicks();
  const body = $("chatBody"); body.scrollTop = body.scrollHeight;
}

function chatMsgHtml(m) {
  if (m.role === "user") {
    /* 消息入库时带有【当前上下文】前缀（供 AI 保持题目一致），展示时剥掉 */
    const shown = String(m.content || "")
      .replace(/^【当前上下文】\n[\s\S]*?\n\n/, "");
    return `<div class="msg me">${esc(shown)}</div>`;
  }
  if (!m.content) return `<div class="msg bot" data-mid="${m.id}"><span class="typing"><i></i><i></i><i></i></span></div>`;
  return `<div class="msg bot md-body" data-mid="${m.id}">${md(m.content)}</div>`;
}

const QUICKS = {
  practice: ["提示我思路", "为什么我选的不对", "出2道同类题"],
  wrong: ["分析我的错因", "再讲一遍", "安排针对性练习"],
  plan: ["调整今日计划", "我要请假", "看看本周进度"],
  notes: ["润色笔记", "生成记忆卡片", "出3道检测题"],
  report: ["解读这份报告", "写入下周计划"],
  general: ["我该怎么安排今天"],
};

/* 快捷指令展示图标（data-v 仍为纯文本，避免破坏指令匹配） */
const QUICK_ICON = {
  "提示我思路": "💡", "为什么我选的不对": "❓", "出2道同类题": "🎯",
  "分析我的错因": "🔍", "再讲一遍": "📖", "安排针对性练习": "🎯",
};

function renderQuicks() {
  const type = ctxType();
  $("chatQuicks").innerHTML = `<div class="quick">
    ${(QUICKS[type] || QUICKS.general).map((q) =>
      `<span data-act="quick" data-v="${esc(q)}">${QUICK_ICON[q] ? QUICK_ICON[q] + " " : ""}${esc(q)}</span>`).join("")}</div>`;
}

function ctxType() {
  const p = state.practice;
  if (state.screen === "practice") return "practice";
  if (state.screen === "wrong") return "wrong";
  if (state.screen === "plan") return "plan";
  if (state.screen === "notes") return "notes";
  if (state.screen === "report") return "report";
  return "general";
}

function buildCtx() {
  const screen = state.screen, p = state.practice;
  if (screen === "practice") {
    if (p.session) {
      const q = p.session.questions[p.session.idx];
      const ans = p.session.answers[q.globalId];
      return { type: "practice", data: {
        题干: stripHtml(q.contentHtml).slice(0, 400),
        选项: q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${stripHtml(o)}`),
        我的答案: ans ? letters(ans) : "暂未作答",
      } };
    }
    if (p.review) {
      /* 取当前展开（或最近点开）的题目作为上下文，默认第一题 */
      const ri = (p.review.openIdx != null && p.review.items[p.review.openIdx])
        ? p.review.openIdx : 0;
      const it = p.review.items[ri];
      return { type: "practice", data: {
        题号: `第 ${ri + 1} 题 / 共 ${p.review.items.length} 题`,
        题干: it.question, 正确答案: it.correctAnswer,
        我的答案: it.myAnswer || "未记录作答（以我口述的为准）",
        粉笔解析: (it.analysis || "").slice(0, 600),
      } };
    }
  }
  if (screen === "wrong" && state.wrong.sel) {
    const it = state.wrong.sel;
    return { type: "wrong", data: {
      题干: stripHtml(it.content_html), 选项: it.options,
      我的答案: it.my_answer || state.wrong.quiz[it.id]?.picked || "未记录作答", 正确答案: it.correct_answer,
      解析: (it.analysis || "").slice(0, 600),
      错误次数: it.wrong_count, 掌握度: (it.masteryEff ?? it.mastery) + "%",
    } };
  }
  if (screen === "plan") {
    return { type: "plan", data: {
      今日任务: state.plan.tasks.map((t) =>
        `${t.status === "done" ? "[完成]" : "[未完成]"} ${t.title}`),
    } };
  }
  if (screen === "notes" && state.notes.sel) {
    return { type: "notes", data: { 标题: state.notes.sel.title, 正文: state.notes.sel.body } };
  }
  if (screen === "report" && state.report.data) {
    const d = state.report.data;
    return { type: "report", data: {
      刷题量: d.questions, 正确率: d.accuracy + "%",
      学习时长: d.hours + "h", 连续打卡: d.streak + "天",
      各模块: d.modules.map((m) => `${m.name}${m.accuracy}%`),
      AI点评: state.report.review,
    } };
  }
  return { type: "general", data: {} };
}

async function sendChat(text) {
  text = (text || "").trim();
  if (!text || state.chat.busy) return;
  state.chat.busy = true;
  state.chat.msgs.push({ role: "user", content: text });
  const ctx = buildCtx();
  const placeholder = { role: "assistant", content: "", id: "pending" };
  state.chat.msgs.push(placeholder);
  renderChat();
  try {
    const res = await api.chat_send({ text, ctxType: ctx.type, ctxData: ctx.data });
    placeholder.id = res.id;
    $("chatBody").lastElementChild.setAttribute("data-mid", res.id);
  } catch (e) {
    state.chat.msgs.pop();
    toast("发送失败", errText(e), "err");
    renderChat();
  }
  state.chat.busy = false;
}

/* --------------------- 同类题：直接从粉笔题库出题 --------------------- */
async function openSimilar(label) {
  const payload = { limit: 2 };
  if (state.screen === "wrong" && state.wrong.sel) {
    const it = state.wrong.sel;
    payload.keypointName = it.keypoint || "";
    payload.moduleName = it.module_name || "";
    payload.excludeGid = it.global_id;
  } else if (state.screen === "practice" && state.practice.session) {
    const s = state.practice.session;
    if (s.kind === "keypoint" && s.sourceId != null) payload.keypointId = s.sourceId;
    else payload.moduleName = s.module || "";
  } else if (state.screen === "practice" && state.practice.review) {
    const r = state.practice.review;
    const target = r.items.find((x) => !x.correct) || r.items[0];
    if (target) {
      payload.keypointName = (target.keypoints || [])[0] || "";
      payload.excludeGid = target.globalId;
    }
  }

  const c = state.chat;
  c.msgs.push({ role: "user", content: label });
  c.msgs.push({ role: "assistant", content: "", id: "pending-sim" });
  renderChat();

  try {
    const data = await api.practice_similar(payload);
    const m = c.msgs.find((x) => x.id === "pending-sim");
    if (m) {
      m.content = `好的，已从**粉笔题库**挑来 ${data.questions.length} 道同类题，开始作答吧，加油 💪`;
      m.id = "done-sim-" + Date.now();
      renderChat();
    }
    $("floatChat").classList.remove("on");
    $("floatBall").style.display = "";
    state.screen = "practice";
    state.practice.review = null;
    beginSession(data);
  } catch (e) {
    const m = c.msgs.find((x) => x.id === "pending-sim");
    if (m) {
      m.content = "抱歉，从粉笔题库取同类题失败：" + errText(e);
      m.id = "err-sim-" + Date.now();
    }
    renderChat();
    toast("取同类题失败", errText(e), "err");
  }
}

/* ------------------------------------------------------- Python 事件 ----- */
window.__appEvent = (ev, p) => {
  if (ev === "toast") toast(p.title, p.text, p.kind || "info", 8000);
  if (ev === "fenbiLogin:success") {
    state.connect.waiting = false;
    state.init.cookieSet = true;
    state.practice.treeLoaded = false;
    const maskOn = $("connectMask").classList.contains("on");
    if (maskOn) { afterConnected(); return; }
    if (state.screen === "settings") render();
  }
  if (ev === "fenbiLogin:closed") {
    if ($("connectMask").classList.contains("on") && state.connect.waiting) {
      state.connect.waiting = false;
      renderConnect();
      toast("登录窗口已关闭", "未获取到登录状态", "info", 3000);
    }
  }
  if (ev === "fenbiLogin:timeout") {
    if ($("connectMask").classList.contains("on") && state.connect.waiting) {
      state.connect.waiting = false;
      renderConnect();
    }
    toast("等待登录超时", p.text || "可重新打开登录页再试", "err");
  }
  if (ev === "fenbiLogin:error") {
    toast("登录验证失败", p.text || "", "err");
  }
  if (ev === "wrongSync:progress") updateSyncMask(p);
  if (ev === "chat:delta") {
    const el = document.querySelector(`[data-mid="${p.id}"]`);
    if (el) {
      const m = state.chat.msgs.find((x) => String(x.id) === String(p.id));
      if (m) {
        if (el.querySelector(".typing")) el.innerHTML = "";
        m.content += p.piece;
        /* 节流：每 150ms 渲染一次，避免长回答逐字重排导致卡死 */
        const now = Date.now();
        if (!m._rt || now - m._rt >= 150) {
          m._rt = now;
          el.innerHTML = md(m.content);
        }
      } else {
        el.textContent += p.piece;
      }
      const body = $("chatBody");
      if (body) body.scrollTop = body.scrollHeight;
    }
  }
  if (ev === "chat:done") {
    const el = document.querySelector(`[data-mid="${p.id}"]`);
    const m = state.chat.msgs.find((x) => String(x.id) === String(p.id));
    if (el && m) el.innerHTML = md(m.content);   /* 收尾强制整段渲染 */
    if (el && !m && !el.textContent) el.textContent = "（已完成）";
  }
  if (ev === "chat:error") {
    const el = document.querySelector(`[data-mid="${p.id}"]`);
    if (el) el.textContent = "出错了：" + p.error;
    toast("小岸出错", p.error, "err");
  }
};

/* #####################################################################
   长按排除选项（作答时按住选项 0.45 秒）
##################################################################### */
let lpTimer = null, lpFired = false, lpX = 0, lpY = 0;

function excludeByLongPress(opt) {
  const act = opt.dataset.act;
  let excludedNow = false;
  if (act === "pick") {
    const s = state.practice.session;
    if (!s) return;
    const gid = s.questions[s.idx].globalId;
    const i = Number(opt.dataset.v);
    const ex = s.excluded[gid] || [];
    s.excluded[gid] = ex.includes(i) ? ex.filter((x) => x !== i) : [...ex, i];
    excludedNow = s.excluded[gid].includes(i);
    renderSession();
  } else if (act === "wPick") {
    const w = state.wrong, it = w.sel;
    if (!it || w.quiz[it.id]) return;
    const v = opt.dataset.v;
    const ex = w.excluded[it.id] || [];
    w.excluded[it.id] = ex.includes(v) ? ex.filter((x) => x !== v) : [...ex, v];
    excludedNow = w.excluded[it.id].includes(v);
    renderWrongMain();
  } else return;
  toast(excludedNow ? "已排除该选项" : "已取消排除", "", "info", 1500);
}

document.addEventListener("pointerdown", (e) => {
  const opt = e.target.closest
    ? e.target.closest('.opt[data-act="pick"], .opt[data-act="wPick"]') : null;
  lpFired = false;
  if (!opt) return;
  lpX = e.clientX; lpY = e.clientY;
  if (lpTimer) clearTimeout(lpTimer);
  lpTimer = setTimeout(() => {
    lpTimer = null; lpFired = true;
    excludeByLongPress(opt);
  }, 450);
}, true);
["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
  document.addEventListener(ev, () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
  }, true));
document.addEventListener("pointermove", (e) => {
  if (!lpTimer) return;
  if (Math.hypot(e.clientX - lpX, e.clientY - lpY) > 12) {
    clearTimeout(lpTimer); lpTimer = null;
  }
}, true);
document.addEventListener("contextmenu", (e) => {
  if (e.target.closest && e.target.closest('.opt[data-act="pick"], .opt[data-act="wPick"]'))
    e.preventDefault();
});

/* 解析关键句着色：只在标签之间的文本段替换，不碰标签属性 */
function emphAnalysis(html) {
  return String(html || "").split(/(<[^>]*>)/g).map((seg) => {
    if (seg.startsWith("<")) return seg;
    return seg
      .replace(/((?:正确答案|故选|应选|因此选|答案是)[^，。；！？\s<]{0,8})/g,
        '<b class="kw-ok">$1</b>')
      .replace(/(排除|不能同时出现|不成立|与题干不一致|错误|不正确)/g,
        '<b class="kw-no">$1</b>');
  }).join("");
}

/* 点击题目/解析里的图片 → 全屏查看，点击任意处关闭 */
document.addEventListener("click", (e) => {
  const mask = document.querySelector(".img-mask");
  if (mask) {
    mask.classList.remove("on");
    setTimeout(() => mask.remove(), 180);
    if (!e.target.closest(".stem img, .q-material img, .analysis-box img, .opt-body img"))
      return;
  }
  const img = e.target.closest(".stem img, .q-material img, .analysis-box img, .opt-body img");
  if (!img) return;
  e.stopPropagation();
  const m = document.createElement("div");
  m.className = "img-mask";
  m.innerHTML = `<img src="${img.currentSrc || img.src}" alt="图片查看">`;
  document.body.appendChild(m);
  requestAnimationFrame(() => m.classList.add("on"));
}, true);

/* #####################################################################
   全局事件委托
##################################################################### */
document.addEventListener("click", async (e) => {
  /* 长按排除后吞掉紧随的 click，避免误选 */
  if (lpFired) { lpFired = false; return; }
  const railBtn = e.target.closest(".rail button[data-s]");
  if (railBtn) { await go(railBtn.dataset.s); return; }
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act, v = el.dataset.v, id = el.dataset.id;

  switch (act) {
    /* 导航 */
    case "go": go(v); break;

    /* 刷题 */
    case "ptab": state.practice.tab = v; render(); break;
    case "histOpen": {
      el.disabled = true;
      try {
        const res = await api.practice_history_detail(Number(id));
        state.practice.review = res;
        state.practice.session = null;
        render();
      } catch (err) {
        el.disabled = false;
        toast("打开失败", errText(err), "err");
      }
      break;
    }
    case "histBack":
      state.practice.review = null; render(); break;
    case "treeToggle":
      state.practice.expanded.has(Number(id))
        ? state.practice.expanded.delete(Number(id))
        : state.practice.expanded.add(Number(id));
      renderTreeBox(); break;
    case "selKp": {
      const node = findNode(state.practice.tree, id);
      if (node) { state.practice.selNode = node; render(); }
      break;
    }
    case "lim": state.practice.limit = Number(v); renderStartMain(); break;
    case "startKp": {
      el.disabled = true; el.textContent = "正在创建练习…";
      try {
        const data = await api.practice_start_keypoint(id, state.practice.limit);
        beginSession(data);
      } catch (err) {
        el.disabled = false; el.textContent = "开始练习";
        toast("创建练习失败", errText(err), "err");
      }
      break;
    }
    case "paperPage": {
      const info = state.practice;
      info.paperPage = Math.max(0, info.paperPage + Number(v));
      try { await loadPapers(); } catch (err) { toast("加载失败", errText(err), "err"); }
      break;
    }
    case "startPaper": {
      const ok = await askConfirm("开始整卷练习", "整卷题目较多，确认现在开始？");
      if (!ok) break;
      try {
        const data = await api.practice_start_paper(id);
        beginSession(data);
      } catch (err) { toast("开始失败", errText(err), "err"); }
      break;
    }
    case "nav": {
      const s = state.practice.session;
      s.idx = Math.min(s.questions.length - 1, Math.max(0, s.idx + Number(v)));
      renderSession(); break;
    }
    case "jump": state.practice.session.idx = Number(v); renderSession(); break;
    case "multi": {
      const s = state.practice.session, q = s.questions[s.idx];
      s.multi.has(q.globalId) ? s.multi.delete(q.globalId) : s.multi.add(q.globalId);
      renderSession(); break;
    }
    case "pick": {
      const s = state.practice.session, q = s.questions[s.idx], opt = Number(v);
      const ex = s.excluded[q.globalId] || [];
      if (ex.includes(opt)) {
        s.excluded[q.globalId] = ex.filter((x) => x !== opt);
        renderSession(); break;
      }
      const cur = s.answers[q.globalId] || [];
      if (s.multi.has(q.globalId)) {
        s.answers[q.globalId] = cur.includes(opt)
          ? cur.filter((x) => x !== opt) : [...cur, opt];
      } else s.answers[q.globalId] = [opt];
      renderSession(); break;
    }
    case "submit": doSubmit(); break;
    case "revToggle": {
      const item = el.closest(".review-item");
      item.classList.toggle("open");
      /* 记录最近展开的题目序号，AI 上下文跟随它 */
      const rv = state.practice.review;
      if (rv && item.classList.contains("open")) {
        const i = Number(item.dataset.idx);
        if (!Number.isNaN(i)) rv.openIdx = i;
      }
      break;
    }
    case "reviewAgain":
      state.practice.review = null; state.practice.selNode = null; render(); break;
    case "askAi": openChat(); break;
    case "askAbout": {
      /* 「问小岸这道题」：把上下文切到该题，而不是固定第一题 */
      const rv = state.practice.review;
      if (rv) {
        const i = rv.items.findIndex((x) =>
          String(x.globalId) === String(el.dataset.id));
        if (i >= 0) rv.openIdx = i;
      }
      openChat(); toast("已带入题目", "直接在对话框追问即可", "info", 2500); break;
    }

    /* 错题 */
    case "wtab": state.wrong.tab = v; state.wrong.loaded = true; refreshWrong(); break;
    case "wsort": state.wrong.sort = v; refreshWrong(); break;
    case "goReviewDue": {
      const w = state.wrong;
      w.dueMode = true; w.dueLoaded = false; w.sel = null; w.quiz = {};
      go("wrong"); break;
    }
    case "wDueExit": {
      const w = state.wrong;
      w.dueMode = false; w.dueLoaded = false; w.sel = null; w.loaded = false;
      render(); break;
    }
    case "weakTrain": {
      try {
        toast("正在出题", "按薄弱考点从粉笔题库组卷…", "info", 2500);
        const data = await api.practice_similar({
          keypointName: el.dataset.kp || "",
          moduleName: el.dataset.mod || "",
          limit: 5,
        });
        beginSession(data);
      } catch (err) { toast("特训出题失败", errText(err), "err"); }
      break;
    }
    case "wmod": state.wrong.module = v; refreshWrong(); break;
    case "wsel": {
      state.wrong.sel = state.wrong.list.find((x) => x.id === Number(id));
      renderWrong(); break;
    }
    case "wPick": {
      const w = state.wrong, it = w.sel;
      if (!it || w.quiz[it.id]) break;
      const ex = w.excluded[it.id] || [];
      if (ex.includes(v)) {
        w.excluded[it.id] = ex.filter((x) => x !== v);
        renderWrongMain(); break;
      }
      const correctSet = new Set((it.correct_answer || "").split(",").filter(Boolean));
      w.quiz[it.id] = { picked: v, correct: correctSet.has(v) };
      try { await api.wrong_record_answer({ id: it.id, answer: v }); it.my_answer = v; }
      catch (err) { /* 本地判定已生效，落库失败不阻塞 */ }
      renderWrongMain();
      break;
    }
    case "wPrev":
    case "wNext": {
      const w = state.wrong;
      const i = w.list.findIndex((x) => x.id === w.sel.id);
      const ni = act === "wPrev" ? i - 1 : i + 1;
      if (ni >= 0 && ni < w.list.length) { w.sel = w.list[ni]; renderWrong(); }
      break;
    }
    case "wBack":
      state.wrong.sel = null; render(); break;
    case "wJudge": await judgeAndGo(v); break;
    case "wReactivate": {
      try {
        await api.wrong_action(id, "reactivate");
        toast("已重新加入", "该题回到待复习列表", "ok");
        refreshWrong();
      } catch (err) { toast("操作失败", errText(err), "err"); }
      break;
    }
    case "wAsk": openChat(); break;
    case "wSync": await syncWrongFromCloud(); break;

    /* 笔记 */
    case "noteNew": {
      const r = await api.notes_save({ title: "新建笔记", body: "", tags: "" });
      state.notes.sel = { id: r.id, title: "新建笔记", body: "", tags: "" };
      renderNotes(); break;
    }
    case "noteSel":
      state.notes.sel = state.notes.list.find((x) => x.id === Number(id));
      renderNotes(); break;
    case "noteEdit": state.notes.preview = false; renderNotes(); break;
    case "notePreviewToggle": state.notes.preview = true; renderNotes(); break;
    case "noteSave": {
      const body = {
        id: Number(id), title: $("noteTitle").value,
        tags: $("noteTags").value, linked_global: $("noteLink").value,
        body: $("noteBody") ? $("noteBody").value : (state.notes.sel?.body || ""),
      };
      try {
        await api.notes_save(body);
        state.notes.sel = { ...state.notes.sel, ...body };
        toast("已保存", "", "ok", 2000); renderNotes();
      } catch (err) { toast("保存失败", errText(err), "err"); }
      break;
    }
    case "noteDel": {
      const ok = await askConfirm("删除笔记", "确定删除这篇笔记？不可恢复。");
      if (!ok) break;
      await api.notes_delete(id);
      state.notes.sel = null; renderNotes(); break;
    }
    case "noteAsk": openChat(); break;
    case "noteExportPdf": {
      const btn = document.querySelector(`[data-act="noteExportPdf"][data-id="${id}"]`);
      if (btn) { btn.disabled = true; btn.textContent = "正在生成…"; }
      try {
        const r = await api.notes_export_pdf(Number(id));
        if (!r || !r.cancelled) toast("已导出", r.path || "", "ok", 4000);
      } catch (err) { toast("导出失败", errText(err), "err"); }
      renderNotes(); break;
    }

    /* 计划 */
    case "aiTasks": {
      el.disabled = true; el.textContent = "AI 生成中…";
      try {
        await api.tasks_ai_generate();
        toast("今日任务已生成", "", "ok", 2200); renderPlan();
      } catch (err) { toast("生成失败", errText(err), "err"); renderPlan(); }
      break;
    }
    case "addTask": {
      const title = $("newTaskTitle").value.trim(), min = Number($("newTaskMin").value || 30);
      if (!title) { toast("请填写任务", "", "err", 2000); break; }
      await api.tasks_save({ title, duration_min: min, required: false });
      renderPlan(); break;
    }
    case "taskToggle": await api.tasks_toggle(id); renderPlan(); break;
    case "taskDel": await api.tasks_delete(id); renderPlan(); break;
    case "focusStart": {
      const f = state.plan.focus;
      f.running = true; f.last = Date.now();
      clearInterval(f.int);
      f.int = setInterval(() => { f.elapsed += Date.now() - f.last; f.last = Date.now(); }, 250);
      renderPlan(); break;
    }
    case "focusPause": {
      const f = state.plan.focus;
      f.running = false; f.elapsed += Date.now() - f.last;
      clearInterval(f.int); renderPlan(); break;
    }
    case "focusReset": {
      const f = state.plan.focus;
      clearInterval(f.int); f.running = false; f.elapsed = 0; renderPlan(); break;
    }
    case "focusSave": {
      const f = state.plan.focus;
      if (f.running) { f.elapsed += Date.now() - f.last; f.running = false; clearInterval(f.int); }
      try {
        await api.focus_save(Math.round(f.elapsed / 1000));
        toast("已记录学习时长", Math.round(f.elapsed / 60) + " 分钟", "ok");
        f.elapsed = 0; renderPlan();
      } catch (err) { toast("记录失败", errText(err), "err"); }
      break;
    }

    /* 报告 */
    case "period":
      state.report.period = v; state.report.data = null;
      state.report.review = ""; renderReport(); break;
    case "aiReport": {
      el.disabled = true;
      try {
        state.report.review = await api.report_ai_review(state.report.period);
        renderReportMain();
      } catch (err) { toast("生成失败", errText(err), "err"); el.disabled = false; }
      break;
    }
    case "openShare": openShareModal(); break;
    case "pSw": shareLocal.privacy[v] = !shareLocal.privacy[v];
      el.classList.toggle("on"); break;
    case "posterGen": posterGenerate(); break;
    case "posterSave": posterSave(); break;

    /* 首次连接粉笔账号 */
    case "ctab": state.connect.tab = v; renderConnect(); break;
    case "connectSkip": $("connectMask").classList.remove("on"); break;
    case "connectCookie": {
      const cookie = $("connectCookieText").value.trim();
      if (!cookie) { toast("请粘贴 Cookie", "", "err", 2200); break; }
      el.disabled = true; el.textContent = "验证中…";
      try {
        await api.fenbi_save_cookie(cookie);
        await afterConnected();
      } catch (err) {
        el.disabled = false; el.textContent = "保存并验证";
        toast("Cookie 无效", errText(err), "err");
      }
      break;
    }
    case "connectOpenPage": {
      try {
        await api.fenbi_open_login_page();
        state.connect.waiting = true;
        renderConnect();
        toast("登录页已打开", "在弹出的粉笔窗口中扫码或登录，成功后自动连接", "info", 4000);
      } catch (err) { toast("打开失败", errText(err), "err"); }
      break;
    }
    case "connectCancel": {
      state.connect.waiting = false;
      renderConnect();
      api.fenbi_cancel_login_page().catch(() => {});
      break;
    }
    case "connectFinish": {
      /* 手动兜底：成功由 fenbiLogin:success 事件统一处理 */
      el.disabled = true; el.textContent = "正在获取登录状态…";
      try {
        await api.fenbi_finish_login_page();
      } catch (err) {
        el.disabled = false;
        el.textContent = "未自动识别？点此立即获取一次";
        toast("未检测到登录", errText(err), "err");
      }
      break;
    }
    case "debugCookie": {
      el.disabled = true; el.textContent = "查询中…";
      try {
        const info = await api.fenbi_debug_cookies();
        const box = $("debugBox");
        box.style.display = "";
        box.textContent = [
          `📍 当前页面: ${info.url || "(空)"}`,
          `🧭 Cookie 来源: ${info.source || "(未知)"}`,
          `🍪 Cookie 数量: ${info.cookie_count}  有 sid=${info.has_sid}  有 userid=${info.has_userid}`,
          `🔑 Cookie 键名: [${(info.keys || []).join(", ") || "（空）"}]`,
          "",
          "原生读取（请求头格式）前 300 字:",
          info.nativeCookie ? info.nativeCookie.slice(0, 300) : "（空）",
        ].join("\n");
      } catch (err) {
        toast("调试失败", errText(err), "err");
      } finally {
        el.disabled = false; el.textContent = "🧪 查看当前浏览器实际 Cookie";
      }
      break;
    }

    /* 设置 */
    case "modelTest": {
      $("modelStatus").textContent = "测试中…";
      try {
        const r = await api.model_test(readModelForm());
        $("modelStatus").innerHTML = `连接正常 · ${r.latencyMs}ms`;
        toast("模型连通", `${r.latencyMs}ms`, "ok");
      } catch (err) {
        $("modelStatus").textContent = "连接失败";
        toast("连接失败", errText(err), "err");
      }
      break;
    }
    case "modelSave":
      try {
        const cfg = readModelForm();
        await api.model_save(cfg);
        state.init.model = { ...cfg, api_key_set: !!cfg.api_key };
        toast("模型设置已保存", "", "ok", 2200); updateTop();
      } catch (err) { toast("保存失败", errText(err), "err"); }
      break;
    case "settingsOpenLogin": {
      try {
        await api.fenbi_open_login_page();
        toast("登录页已打开", "在弹出的粉笔窗口中扫码或登录，成功后自动连接", "info", 4000);
      } catch (err) { toast("打开失败", errText(err), "err"); }
      break;
    }
    case "fenbiLogout": {
      const ok = await askConfirm(
        "退出粉笔账号",
        "将清除本机保存的粉笔登录状态（错题、笔记、计划等学习数据会保留），确定退出吗？",
        "退出登录");
      if (!ok) break;
      el.disabled = true;
      try {
        await api.fenbi_logout();
        state.init.cookieSet = false;
        state.practice.treeLoaded = false;
        state.practice.tree = [];
        await render();
      } catch (err) {
        el.disabled = false;
        toast("退出失败", errText(err), "err");
      }
      break;
    }
    case "cookieSave": {
      const cookie = $("setCookie").value.trim();
      if (!cookie) { toast("请粘贴 Cookie", "", "err"); break; }
      try {
        const info = await api.fenbi_save_cookie(cookie);
        state.init.cookieSet = true;
        const st = $("cookieStatus");
        if (st) st.textContent = "已连接：" + (info?.user?.name || "");
        toast("粉笔账号已连接", "", "ok");
      } catch (err) { toast("验证失败", errText(err), "err"); }
      break;
    }
    case "generalSave": {
      const body = {
        ...state.init.general,
        exam_name: $("setExamName").value.trim(),
        exam_date: $("setExamDate").value,
        daily_target: Number($("setTarget").value || 60),
        reminder_time: $("setRemind").value,
        strict_mode: $("setStrict").checked,
      };
      await api.general_save(body);
      state.init.general = body; updateTop();
      toast("设置已保存", "", "ok", 2200); break;
    }
    case "bgSet": {
      const body = { ...state.init.general, bg_mode: v };
      try {
        await api.general_save(body);
        state.init.general = body;
        applyTheme();
        renderSettings();
        toast("背景已切换", v === "default" ? "已恢复默认白色" : "", "ok", 1800);
      } catch (err) { toast("保存失败", errText(err), "err"); }
      break;
    }
    case "backupExport": {
      try {
        const r = await api.backup_export();
        if (!r.cancelled) toast("已导出", r.path, "ok");
      } catch (err) { toast("导出失败", errText(err), "err"); }
      break;
    }
    case "backupImport": {
      try {
        const r = await api.backup_import();
        if (r && r.needRestart) {
          await askConfirm("恢复已准备好", "请关闭并重新打开软件，恢复即生效。", "知道了");
        }
      } catch (err) { toast("恢复失败", errText(err), "err"); }
      break;
    }

    /* 悬浮对话 */
    case "chatMin":
      $("floatChat").classList.remove("on");
      $("floatBall").style.display = "flex"; break;
    case "chatSend": sendChat($("chatText").value); break;
    case "quick":
      if (v === "出2道同类题" || v === "安排针对性练习") await openSimilar(v);
      else sendChat(v);
      break;
  }
});

/* 输入事件 */
document.addEventListener("input", (e) => {
  const name = e.target.dataset.input;
  if (name === "treeSearch") state.practice.treeQuery = e.target.value, renderTreeBox();
  if (name === "wrongSearch") {
    state.wrong.query = e.target.value;
    clearTimeout(state.wrong._t);
    state.wrong._t = setTimeout(() => refreshWrong().catch(() => {}), 300);
  }
  if (name === "noteSearch") {
    state.notes.query = e.target.value;
    clearTimeout(state.notes._t);
    state.notes._t = setTimeout(() => renderNotes(), 300);
  }
  if (name === "labelSel") state.practice.labelId = Number(e.target.value), loadPapers();
  if (name === "setTemp") {
    const lab = e.target.parentElement.querySelector("label");
    if (lab) lab.textContent = `创造性：${(Number(e.target.value) / 100).toFixed(1)}`;
  }
});

/* 切换 AI 服务商：自动填充地址与模型 */
document.addEventListener("change", (e) => {
  if (e.target.id === "setProvider") {
    const p = PROVIDERS.find((x) => x[0] === e.target.value);
    if (p && p[1]) {
      $("setBase").value = p[1];
      $("setModelName").value = p[2];
    }
  }
});

/* 回车发送对话 */
document.addEventListener("keydown", (e) => {
  if (e.target.id === "chatText" && e.key === "Enter") {
    sendChat(e.target.value);
  }
});

/* 悬浮球 */
$("floatBall").addEventListener("click", () => {
  $("floatChat").classList.add("on");
  $("floatBall").style.display = "none";
  renderChat();
});
function openChat() {
  $("floatChat").classList.add("on");
  $("floatBall").style.display = "none";
  renderChat();
}

/* 分享弹窗关闭 */
document.querySelectorAll(".modal-close-x").forEach((b) =>
  b.addEventListener("click", () => $("shareMask").classList.remove("on")));
$("shareMask").addEventListener("click", (e) => {
  if (e.target.id === "shareMask") $("shareMask").classList.remove("on");
});

$("bellBtn").addEventListener("click", () => {
  toast("今日提醒", state.init.general.strict_mode
    ? "严格模式已开启，到点没完成我会找你谈话。"
    : "温和模式：仅记录学习情况。", "info", 3000);
});

/* #####################################################################
   启动
##################################################################### */
let booted = false;
/* 护眼背景：设置里选的底色应用到做题面板 */
function applyTheme() {
  const mode = (state.init.general && state.init.general.bg_mode) || "default";
  document.body.classList.remove("theme-blue", "theme-green", "theme-red");
  if (mode !== "default") document.body.classList.add("theme-" + mode);
}
async function boot() {
  if (booted) return;
  booted = true;
  try {
    state.init = await api.app_init();
    applyTheme();
    updateTop();
    await loadChat();
    await go("practice");
    if (!state.init.cookieSet) openConnect();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;font-size:14px">
      启动失败：${esc(errText(e))}</div>`;
  }
}
window.addEventListener("pywebviewready", boot);

/* 兜底：部分后端可能注入时事件已错过，轮询直到桥接出现 */
if (window.pywebview) {
  boot();
} else {
  let tries = 0;
  const poll = setInterval(() => {
    if (window.pywebview) { clearInterval(poll); boot(); }
    else if (++tries > 150) clearInterval(poll); /* 最长 30s */
  }, 200);
}
