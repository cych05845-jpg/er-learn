/* ================= 學習站小幫手：全站搜尋＋AI 整理回答 =================
   1. 搜尋：在你的手機上比對 search.json（全站每一頁、講義每一節、檢傷判定依據），不連網也能用。
   2. AI 整理：把搜尋到的前幾段原文送到後端（hubAsk），AI 只能根據這幾段回答，並標出處 [1][2]；
      找不到就說「本站沒有」，問題會記到「hub_ask」工作表，給教學組補內容。
   不送姓名或員編給 AI；登入只用來限制每人每天次數。 */
(function(){
  const IDX_URL = "search.json";
  const SYN = { epi: ["epinephrine", "bosmin"], bosmin: ["epinephrine", "epi"], epinephrine: ["bosmin"], cpr: ["壓胸", "心肺復甦"], 心肺復甦: ["cpr"], 壓胸: ["cpr"],
    心肌梗塞: ["stemi", "ami"], stemi: ["心肌梗塞"], ami: ["心肌梗塞"], 中風: ["腦中風", "stroke"], 敗血: ["sepsis", "敗血症"], sepsis: ["敗血症"], 過敏: ["過敏性休克"],
    插管: ["氣管內管", "ett"], ett: ["氣管內管", "插管"], 電擊: ["去顫", "defib"], 鉀: ["高血鉀"], 低血糖: ["d50w", "血糖"], 檢傷: ["ttas", "級數"], ttas: ["檢傷"], 幾級: ["級數", "第1級", "第2級"],
    leader: ["小組長"], 小組長: ["leader"], 999: ["院內急救"], 888: ["大量傷患"], 兒童: ["兒科"], 小孩: ["兒童", "兒科"], 孕婦: ["懷孕", "產科"] };
  const HINTS = ["胸痛 檢傷幾級", "高品質 CPR", "過敏性休克 給藥", "小組長 異常通報", "兒童發燒", "院內代號 999", "ROSC 後照護", "低血糖 處理"];
  let IDX = null, LOADING = null, LAST = { q: "", hits: [] };
  const $q = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const isHub = () => !!document.getElementById("view") && typeof go === "function";
  const api = () => String((window.ER_CONFIG && window.ER_CONFIG.DRILL_API) || "").trim();
  const tokOf = () => { try { const A = window.ACCOUNT || null; return A && A.token && A.token() || ""; } catch (e) { return ""; } };

  /* ---------- 斷詞：中文兩字一組，英數一個字 ---------- */
  function toks(s){
    s = String(s || "").toLowerCase().replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/₂/g, "2");
    const out = [];
    (s.match(/[a-z0-9][a-z0-9.+%-]*|[㐀-鿿]+/g) || []).forEach(w => {
      if (/^[㐀-鿿]/.test(w)) { if (w.length === 1) out.push(w); else for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2)); }
      else if (w.length > 1 || /\d/.test(w)) out.push(w.replace(/[.%-]+$/, ""));
    });
    return out;
  }
  function build(J){
    const C = J.c, df = new Map(); let tot = 0;
    C.forEach(c => { const tf = new Map(), add = (t, w) => tf.set(t, (tf.get(t) || 0) + w);
      toks(c.t).forEach(t => add(t, 3)); toks(c.s).forEach(t => add(t, 1)); const xt = toks(c.x); xt.forEach(t => add(t, 1));
      c._tf = tf; c._len = xt.length + 6; tot += c._len; c._lx = (c.t + " " + c.x).toLowerCase(); tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)); });
    return { C, df, N: C.length, avg: tot / C.length, v: J.v };
  }
  function load(){
    if (IDX) return Promise.resolve(IDX);
    return LOADING || (LOADING = fetch(IDX_URL, { cache: "no-cache" }).then(r => r.json()).then(j => IDX = build(j)).catch(e => { LOADING = null; throw e; }));
  }
  function expand(q){
    const base = toks(q), extra = [];
    Object.keys(SYN).forEach(k => { if (q.toLowerCase().includes(k)) SYN[k].forEach(s => extra.push(...toks(s))); });
    return { base: [...new Set(base)], extra: [...new Set(extra.filter(t => !base.includes(t)))] };
  }
  function search(q, n){
    const { base, extra } = expand(q); if (!base.length) return [];
    const { C, df, N, avg } = IDX, k1 = 1.2, b = .75, ql = q.trim().toLowerCase();
    const idf = t => Math.log(1 + (N - (df.get(t) || 0) + .5) / ((df.get(t) || 0) + .5));
    const hits = [];
    C.forEach(c => { let s = 0, m = 0;
      const sc = (t, w) => { const f = c._tf.get(t); if (!f) return; m++; s += w * idf(t) * f * (k1 + 1) / (f + k1 * (1 - b + b * c._len / avg)); };
      base.forEach(t => sc(t, 1)); extra.forEach(t => sc(t, .7));
      if (!s) return;
      const cover = base.filter(t => c._tf.has(t)).length / base.length; s *= .35 + cover;
      if (ql.length >= 2 && c._lx.includes(ql)) s += 4;
      s *= c.w || 1;
      hits.push({ c, s }); });
    hits.sort((a, b2) => b2.s - a.s);
    const per = {}, out = [];   // 同一頁最多兩段
    for (const h of hits) { const k = h.c.u.replace(/-s\d+$/, ""); per[k] = (per[k] || 0) + 1; if (per[k] > 2) continue; out.push(h); if (out.length >= (n || 8)) break; }
    const top = out[0] ? out[0].s : 0; return out.filter(h => h.s >= Math.max(1.2, top * .22));
  }
  function snippet(x, q){
    const T = [...new Set(toks(q))], L = x.replace(/\n+/g, "　"), low = L.toLowerCase(); let best = 0, bi = 0;
    for (let i = 0; i < low.length; i += 12) { const w = low.slice(i, i + 96); const s = T.filter(t => w.includes(t)).length; if (s > best) { best = s; bi = i; } }
    let s = L.slice(Math.max(0, bi - 8), bi + 104); if (bi > 8) s = "…" + s; if (bi + 104 < L.length) s += "…";
    let h = esc(s); T.filter(t => t.length > 1 || /[㐀-鿿]/.test(t)).sort((a, b) => b.length - a.length).forEach(t => { h = h.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), m => `<mark>${m}</mark>`); });
    return h.replace(/<mark>(<mark>)+/g, "<mark>").replace(/(<\/mark>)+/g, "</mark>");
  }
  const href = u => isHub() ? (u.startsWith("#") ? u : u) : (u.startsWith("#") ? "index.html" + u : u);
  const icon = u => /^handouts/.test(u) ? "📖" : /^#lk-/.test(u) ? "🏷️" : /^#lc-/.test(u) ? "🎓" : /qs-/.test(u) ? "🗺️" : /^#(wt|rt|jt)-/.test(u) ? "🩺" : "📄";

  /* ---------- 介面 ---------- */
  const CSS = `
  .askbtn{display:inline-flex;align-items:center;gap:6px}
  .askorb{width:22px;height:22px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:12px;
    background:radial-gradient(circle at 32% 28%,#fff 0 8%,#BFE6F7 18%,#4AA3CF 55%,#14506B 100%);box-shadow:inset -2px -3px 5px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.25);animation:askBob 3.2s ease-in-out infinite}
  @keyframes askBob{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-2px) rotate(-8deg)}}
  .askbar{position:relative;display:flex;align-items:center;gap:12px;width:100%;border:0;text-align:left;border-radius:18px;padding:14px 16px;color:var(--ink);
    background:linear-gradient(145deg,color-mix(in srgb,var(--surface) 92%,#BFE6F7),var(--surface));border:1px solid var(--line);
    box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 10px 24px -12px rgba(20,80,107,.45),0 2px 0 color-mix(in srgb,var(--line) 80%,#000 6%);
    transform:perspective(800px) rotateX(0);transition:transform .25s,box-shadow .25s}
  .askbar:hover{transform:perspective(800px) rotateX(4deg) translateY(-2px);box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 18px 30px -14px rgba(20,80,107,.55),0 3px 0 color-mix(in srgb,var(--line) 80%,#000 8%)}
  .askbar:active{transform:perspective(800px) translateY(1px) scale(.99)}
  .askbar .askorb{width:44px;height:44px;font-size:22px}
  .askbar b{display:block;font-size:16.5px}.askbar small{display:block;color:var(--ink-2);font-size:13.5px;line-height:1.4}
  .askbar .kbd{margin-left:auto;font:600 12px var(--f-data);color:var(--ink-2);border:1px solid var(--line);border-radius:7px;padding:2px 7px;background:var(--surface)}
  .askbar::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.55) 45%,transparent 60%);background-size:250% 100%;animation:askShine 5s ease-in-out infinite;mix-blend-mode:soft-light}
  @keyframes askShine{0%,70%{background-position:130% 0}100%{background-position:-30% 0}}
  .asksh{position:fixed;inset:0;z-index:80;background:rgba(10,22,30,.46);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);display:grid;place-items:start center;padding:calc(env(safe-area-inset-top,0px) + 14px) 12px 12px;overflow-y:auto}
  .asksh[hidden]{display:none}
  .askp{width:min(720px,100%);background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:22px;padding:16px;display:grid;gap:12px;
    box-shadow:0 30px 60px -20px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.6) inset;transform-origin:50% 0;animation:askIn .38s cubic-bezier(.2,.9,.25,1.15)}
  @keyframes askIn{from{opacity:0;transform:perspective(900px) rotateX(-18deg) translateY(-24px) scale(.96)}to{opacity:1;transform:none}}
  .askhd{display:flex;align-items:center;gap:10px}.askhd .askorb{width:34px;height:34px;font-size:17px}.askhd b{font-size:17px}.askx{margin-left:auto;flex:none;width:40px;height:40px;border-radius:12px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);font-size:17px}
  .askin{display:flex;gap:8px}.askin input{flex:1;min-width:0;height:50px;border-radius:14px;border:2px solid var(--line);padding:0 14px;font-size:17px;background:var(--bg)}
  .askin input:focus{border-color:var(--brand);outline:0;box-shadow:0 0 0 4px color-mix(in srgb,var(--brand) 22%,transparent)}
  .askchips{display:flex;flex-wrap:wrap;gap:8px}.askchips button{border:1px solid var(--line);background:var(--surface-2);border-radius:999px;padding:6px 13px;font-size:14px;transition:transform .15s}
  .askchips button:hover{transform:translateY(-2px)}
  .askai{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .askai .go{border:0;border-radius:14px;padding:11px 18px;font-weight:800;font-size:15.5px;color:#fff;background:linear-gradient(135deg,#5B3A8C,#14506B);box-shadow:0 6px 0 #0d3447,0 12px 20px -8px rgba(20,80,107,.6);transition:transform .12s,box-shadow .12s}
  .askai .go:active{transform:translateY(5px);box-shadow:0 1px 0 #0d3447}.askai .go[disabled]{opacity:.55}
  .askai small{color:var(--ink-2);font-size:13px;flex:1;min-width:180px}
  .askans{position:relative;border-radius:16px;padding:14px 16px;background:var(--bg);border:1px solid var(--line);line-height:1.75;font-size:15.5px;animation:askUp .35s ease both}
  .askans.load{color:var(--ink-2);overflow:hidden}.askans.load::before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,color-mix(in srgb,var(--brand) 16%,transparent) 50%,transparent 80%);background-size:200% 100%;animation:askShine 1.4s linear infinite}
  .askans .cite{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 5px;margin:0 1px;border-radius:7px;background:var(--brand);color:var(--brand-ink);font:700 12px var(--f-data);text-decoration:none;vertical-align:1px;transform:translateZ(0);transition:transform .15s}
  .askans .cite:hover{transform:translateY(-2px) scale(1.1)}
  .askans .askt{white-space:pre-wrap}.askans .none{color:var(--ink-2)}.askans .src{display:block;margin-top:10px;padding-top:8px;border-top:1px dashed var(--line);font-size:13px;color:var(--ink-2);white-space:normal}
  .askans .rate{display:flex;gap:8px;margin-top:10px;white-space:normal;align-items:center;font-size:13px;color:var(--ink-2)}.askans .rate button{border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:4px 10px}
  .askres{display:grid;gap:10px;perspective:900px}
  .askr{display:grid;grid-template-columns:42px minmax(0,1fr);gap:10px;align-items:start;padding:12px;border-radius:14px;border:1px solid var(--line);background:var(--surface);color:var(--ink);text-decoration:none;
    box-shadow:0 2px 0 var(--line),0 8px 16px -12px rgba(0,0,0,.35);animation:askUp .32s ease both;animation-delay:calc(var(--i)*45ms);transition:transform .18s,box-shadow .18s}
  .askr:hover,.askr:focus-visible{transform:translateY(-3px) rotateX(5deg);box-shadow:0 4px 0 var(--line),0 16px 24px -14px rgba(0,0,0,.45)}
  .askr .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;background:linear-gradient(150deg,var(--surface-2),var(--surface));box-shadow:inset 0 -3px 0 var(--line)}
  .askr b{display:block;font-size:15.5px;line-height:1.35}.askr i{font-style:normal;color:var(--ink-2);font-size:12.5px}.askr p{margin:4px 0 0;font-size:14px;color:var(--ink-2);line-height:1.6}
  .askr .n{font:700 11px var(--f-data);color:var(--brand);margin-right:6px}
  .askr mark{background:color-mix(in srgb,#F6C445 55%,transparent);color:inherit;border-radius:3px;padding:0 1px}
  @keyframes askUp{from{opacity:0;transform:translateY(12px) rotateX(-10deg)}to{opacity:1;transform:none}}
  .askmiss{text-align:center;color:var(--ink-2);padding:14px;font-size:14.5px}
  .askfoot{font-size:12.5px;color:var(--ink-2);margin:0}
  @media (max-width:520px){.askbtn .t{display:none}.askbtn{padding:0 8px}}
  .askfab{position:fixed;right:16px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:40;border:0;border-radius:999px;padding:10px 16px 10px 10px;display:flex;align-items:center;gap:8px;font-weight:800;color:#fff;background:linear-gradient(135deg,#14506B,#5B3A8C);box-shadow:0 6px 0 #0d3447,0 14px 24px -10px rgba(0,0,0,.5)}
  .askfab .askorb{width:32px;height:32px}
  @media (prefers-reduced-motion:reduce){.askbar,.askbar::after,.askp,.askr,.askans,.askorb{animation:none!important;transition:none!important}}`;
  function css(){ if (document.getElementById("askCSS")) return; const s = document.createElement("style"); s.id = "askCSS"; s.textContent = CSS; document.head.appendChild(s); }

  function sheet(){
    let sh = document.getElementById("askSh"); if (sh) return sh; css();
    sh = document.createElement("div"); sh.id = "askSh"; sh.className = "asksh"; sh.hidden = true; sh.setAttribute("role", "dialog"); sh.setAttribute("aria-label", "學習站小幫手");
    sh.innerHTML = `<div class="askp">
      <div class="askhd"><span class="askorb" aria-hidden="true">✦</span><div><b>學習站小幫手</b><br><small style="color:var(--ink-2);font-size:13px">搜尋全站課程、闖關、講義與檢傷判定依據</small></div><button class="askx" id="askX" type="button" aria-label="關閉">✕</button></div>
      <form class="askin" id="askF"><input id="askQ" type="search" enterkeyhint="search" autocomplete="off" placeholder="想找什麼？例：胸痛幾級、Bosmin、ROSC 後" aria-label="搜尋學習站"></form>
      <div id="askBody"></div>
      <p class="askfoot">⚠ 請不要輸入病人姓名、病歷號等個資。內容以本站教材為準，臨床處置依本院 SOP 與醫囑。</p></div>`;
    document.body.appendChild(sh);
    sh.addEventListener("click", e => { if (e.target === sh || e.target.closest("#askX")) close();
      const c = e.target.closest("[data-hint]"); if (c) { $q("#askQ").value = c.dataset.hint; run(); }
      if (e.target.closest("a.askr, a.cite, .src a")) setTimeout(close, 30);
      if (e.target.closest("#askGo")) aiAsk();
      const rt = e.target.closest("[data-rate]"); if (rt) rate(rt); });
    $q("#askF").onsubmit = e => { e.preventDefault(); run(); };
    let tm; $q("#askQ").oninput = () => { clearTimeout(tm); tm = setTimeout(run, 140); };
    sh.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    return sh;
  }
  function open(q){
    const sh = sheet(); sh.hidden = false; document.body.style.overflow = "hidden";
    const inp = $q("#askQ"); if (q !== undefined) inp.value = q; setTimeout(() => inp.focus(), 60);
    if (!inp.value) idle(); else run();
    load().catch(() => { $q("#askBody").innerHTML = `<p class="askmiss">搜尋資料載入失敗，請檢查網路後再試。</p>`; });
  }
  function close(){ const sh = document.getElementById("askSh"); if (sh) sh.hidden = true; document.body.style.overflow = ""; }
  function idle(){ $q("#askBody").innerHTML = `<div class="askchips">${HINTS.map(h => `<button type="button" data-hint="${esc(h)}">${esc(h)}</button>`).join("")}</div>`; }
  async function run(){
    const q = $q("#askQ").value.trim(); if (!q) return idle();
    await load(); if (q !== $q("#askQ").value.trim()) return;
    const hits = search(q, 8); LAST = { q, hits, ans: null };
    const aiOK = !!api();
    $q("#askBody").innerHTML = (hits.length ? `
      <div class="askai">${aiOK ? `<button class="go" id="askGo" type="button">🤖 請 AI 整理成答案</button><small>只根據下面這幾段本站內容回答，會標出處。</small>` : `<small>（AI 整理尚未開通：學習站還沒設定後端網址）</small>`}</div>
      <div id="askA"></div>
      <div class="askres">${hits.map((h, i) => `<a class="askr" style="--i:${i}" href="${esc(href(h.c.u))}"><span class="ic" aria-hidden="true">${icon(h.c.u)}</span><span><b><span class="n">${i + 1}</span>${esc(h.c.t)}</b><i>${esc(h.c.s)}</i><p>${snippet(h.c.x, q)}</p></span></a>`).join("")}</div>`
      : `<div class="askmiss">本站沒有找到「${esc(q)}」。<br>換個說法試試，例如用主訴、藥名或處置名稱。${aiOK ? `<div style="margin-top:10px"><button class="nbtn" id="askGo" type="button" style="background:var(--surface-2);color:var(--ink);border:1px solid var(--line)">回報：希望站上補這個主題</button></div>` : ""}</div><div id="askA"></div>`);
  }
  async function call(action, b){
    const u = api(); if (!u) return { ok: false, error: "學習站還沒設定後端網址" };
    const t = tokOf(); b = Object.assign({ action, token: t }, b);
    try { const r = await fetch(u, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(b) }); return await r.json(); }
    catch (e) { return { ok: false, error: "連不上伺服器，請檢查網路" }; }
  }
  async function aiAsk(){
    const box = $q("#askA"), btn = $q("#askGo"), q = LAST.q; if (!box || !q) return;
    const ctx = LAST.hits.slice(0, 6).map((h, i) => ({ n: i + 1, t: h.c.t, s: h.c.s, x: h.c.x.slice(0, 900) }));
    if (/\d{6,}/.test(q)) { box.innerHTML = `<div class="askans none">問題裡好像有病歷號或電話等數字，請拿掉後再問。</div>`; return; }
    if (ctx.length && !tokOf()) { box.innerHTML = `<div class="askans none">AI 整理要先登入（只用來計算每人每天次數，不會把姓名送給 AI）。${isHub() ? `<br><button class="nbtn" type="button" id="askLogin" style="margin-top:8px;background:var(--brand);color:var(--brand-ink)">用員編登入</button>` : `<br><a href="index.html">到學習站首頁登入 ›</a>`}</div>`;
      const lg = $q("#askLogin"); if (lg) lg.onclick = () => { close(); const a = document.getElementById("acctBtn"); if (a) a.click(); }; return; }
    btn && (btn.disabled = true); box.innerHTML = `<div class="askans load">AI 正在讀這 ${ctx.length || 0} 段內容…</div>`;
    const r = await call("hubAsk", { q: q.slice(0, 200), ctx, v: IDX && IDX.v });
    btn && (btn.disabled = false);
    if (!r || !r.ok) { box.innerHTML = `<div class="askans none">${esc((r && r.error) || "連線失敗")}</div>`; return; }
    if (!ctx.length) { box.innerHTML = `<div class="askans none">已回報給教學組，謝謝！之後會補上這個主題。</div>`; return; }
    const H = LAST.hits; let t = esc(r.text || "").replace(/\[(\d)\]/g, (m, n) => H[n - 1] ? `<a class="cite" href="${esc(href(H[n - 1].c.u))}" title="${esc(H[n - 1].c.t)}">${n}</a>` : "");
    const used = [...new Set((r.text || "").match(/\[(\d)\]/g) || [])].map(x => +x[1]).filter(n => H[n - 1]);
    box.innerHTML = `<div class="askans${r.none ? " none" : ""}"><div class="askt">${t.trim()}</div>`
      + (used.length ? `<span class="src">出處：${used.map(n => `<a href="${esc(href(H[n - 1].c.u))}">[${n}] ${esc(H[n - 1].c.t)}</a>`).join("　")}</span>` : "")
      + `<span class="rate" data-id="${esc(r.id || "")}">這個回答有幫助嗎？<button type="button" data-rate="1">👍</button><button type="button" data-rate="0">👎</button>${r.left !== undefined ? `<span style="margin-left:auto">今天還可以問 ${r.left} 次</span>` : ""}</span>`
      + `<span class="src" style="border:0;margin-top:4px">AI 整理，可能有誤；請點出處對照原文。</span></div>`;
  }
  async function rate(b){ const w = b.closest(".rate"), id = w && w.dataset.id; if (!id) return; w.innerHTML = "謝謝回饋！"; call("hubAskRate", { id, v: +b.dataset.rate }); }

  /* ---------- 對外 ---------- */
  window.askOpen = open;
  window.askBarHTML = () => { css(); return `<button class="askbar" type="button" onclick="askOpen()"><span class="askorb" aria-hidden="true">✦</span><span><b>問小幫手</b><small>搜尋全站課程、闖關、講義、檢傷判定，也可以請 AI 整理答案</small></span><span class="kbd" aria-hidden="true">/</span></button>`; };
  function mount(){
    css();
    const bar = document.querySelector("#bar .in");
    if (bar && !document.getElementById("askBtn")) { const b = document.createElement("button"); b.className = "nbtn askbtn"; b.id = "askBtn"; b.type = "button"; b.setAttribute("aria-label", "搜尋學習站"); b.innerHTML = `<span class="askorb" aria-hidden="true">✦</span><span class="t">搜尋</span>`; b.onclick = () => open(); const h = document.getElementById("homeBtn"); bar.insertBefore(b, h || null); }
    else if (!bar && !document.getElementById("askFab")) { const b = document.createElement("button"); b.className = "askfab"; b.id = "askFab"; b.type = "button"; b.innerHTML = `<span class="askorb" aria-hidden="true">✦</span>問小幫手`; b.onclick = () => open(); document.body.appendChild(b); }
    addEventListener("keydown", e => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); open(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  window.__askTest = { toks, search: (q, n) => load().then(() => search(q, n)) };
})();
