/* totonoumovie 使い方マニュアル：共通の動き */
(function () {
  "use strict";
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function toast(msg) {
    var t = $(".toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 1800);
  }

  // ---- Mac / Windows（全ページで覚える） ----
  var os = store("tm-os") || (/Win/.test(navigator.platform) ? "win" : "mac");
  function setOS(v) {
    os = v; store("tm-os", v);
    document.body.classList.toggle("os-win", v === "win");
    $$(".os-switch button").forEach(function (b) { b.classList.toggle("on", b.dataset.os === v); });
  }
  $$(".os-switch button").forEach(function (b) { b.addEventListener("click", function () { setOS(b.dataset.os); toast(v2name(b.dataset.os) + " の手順を表示しています"); }); });
  function v2name(v) { return v === "win" ? "Windows" : "Mac"; }
  setOS(os);

  // ---- スマホの目次 ----
  $(".menu-btn").addEventListener("click", function () {
    var open = document.body.classList.toggle("menu-open");
    this.setAttribute("aria-expanded", open);
  });

  // ---- コマンドのコピー ----
  $$(".cmd").forEach(function (box) {
    var pre = $("pre", box);
    var b = document.createElement("button");
    b.className = "copy"; b.type = "button"; b.textContent = "コピー";
    b.addEventListener("click", function () {
      var text = pre.innerText.replace(/\n$/, "");
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
        b.textContent = "✓ コピーしました"; b.classList.add("done");
        setTimeout(function () { b.textContent = "コピー"; b.classList.remove("done"); }, 1800);
      }, function () {
        var r = document.createRange(); r.selectNodeContents(pre);
        var s = getSelection(); s.removeAllRanges(); s.addRange(r);
        toast("選んだ状態にしました。⌘C（Windows は Ctrl+C）でコピーしてください");
      });
    });
    box.appendChild(b);
  });

  // ---- 手順のチェック（ページごとに覚える） ----
  $$("[data-progress]").forEach(function (wrap) {
    var key = "tm-done-" + wrap.dataset.progress;
    var done = {};
    try { done = JSON.parse(store(key) || "{}"); } catch (e) { done = {}; }
    var steps = function () { return $$(".step[data-id]", wrap).filter(function (s) { return s.offsetParent !== null; }); };
    var bar = document.createElement("div");
    bar.className = "progress";
    bar.innerHTML = '<div class="bar"><i></i></div><div class="txt"><span class="c"></span><a href="#" class="reset">チェックを消す</a></div>';
    wrap.insertBefore(bar, wrap.firstChild);
    function update() {
      // 見えている手順に、見出しごとに 1 から番号を振り直す（Mac／Windows で手順の数が違うため）
      $$("section", wrap).forEach(function (sec) {
        var n = 0;
        $$(".step", sec).forEach(function (s) { if (s.offsetParent !== null) s.setAttribute("data-n", ++n); });
      });
      var list = steps(), n = list.filter(function (s) { return done[s.dataset.id]; }).length;
      $(".bar i", bar).style.width = (list.length ? n / list.length * 100 : 0) + "%";
      $(".c", bar).textContent = n === list.length && n ? "🎉 ぜんぶ終わりました！" : "できた " + n + " ／ " + list.length;
    }
    $$(".step[data-id]", wrap).forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "done-btn"; b.textContent = "できた";
      s.appendChild(b);
      if (done[s.dataset.id]) s.classList.add("done");
      b.addEventListener("click", function () {
        done[s.dataset.id] = !done[s.dataset.id];
        s.classList.toggle("done", !!done[s.dataset.id]);
        store(key, JSON.stringify(done)); update();
        if (done[s.dataset.id]) {
          var next = steps().filter(function (x) { return !done[x.dataset.id]; })[0];
          if (next) setTimeout(function () { next.scrollIntoView({ behavior: "smooth", block: "start" }); }, 250);
        }
      });
    });
    $(".reset", bar).addEventListener("click", function (e) {
      e.preventDefault(); done = {}; store(key, "{}");
      $$(".step", wrap).forEach(function (s) { s.classList.remove("done"); }); update();
    });
    $$(".os-switch button").forEach(function (b) { b.addEventListener("click", update); });
    update();
  });

  // ---- 用語の説明（ふきだし） ----
  var pop = null;
  function hideTip() { if (pop) { pop.remove(); pop = null; } }
  $$(".term").forEach(function (t) {
    t.tabIndex = 0;
    function show() {
      hideTip();
      pop = document.createElement("div"); pop.className = "tip-pop"; pop.textContent = t.dataset.tip;
      document.body.appendChild(pop);
      var r = t.getBoundingClientRect();
      pop.style.left = Math.max(10, Math.min(innerWidth - pop.offsetWidth - 10, r.left + scrollX)) + "px";
      pop.style.top = (r.bottom + scrollY + 8) + "px";
    }
    t.addEventListener("mouseenter", show); t.addEventListener("focus", show);
    t.addEventListener("mouseleave", hideTip); t.addEventListener("blur", hideTip);
    t.addEventListener("click", show);
  });

  // ---- このページの見出し（右側） ----
  var toc = $(".toc"), hs = $$(".main h2[id]");
  if (toc && hs.length > 1) {
    toc.innerHTML = "<b>このページ</b>" + hs.map(function (h) { var c = h.cloneNode(true); $$(".num", c).forEach(function (n) { n.remove(); }); return '<a href="#' + h.id + '">' + c.textContent.trim() + "</a>"; }).join("");
    var links = $$("a", toc);
    var onScroll = function () {
      var cur = 0;
      hs.forEach(function (h, i) { if (h.getBoundingClientRect().top < 140) cur = i; });
      links.forEach(function (a, i) { a.classList.toggle("on", i === cur); });
    };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
  }

  // ---- 動画のチャプター ----
  $$("[data-chapters]").forEach(function (meta) {
    var v = document.getElementById(meta.dataset.chapters);
    $$(".chap", meta).forEach(function (b) {
      b.addEventListener("click", function () { v.currentTime = +b.dataset.t; v.play(); });
    });
  });

  // ---- 検索 ----
  var sp = $(".search-pop"), si = $(".search-box input"), sh = $(".search-hits"), sel = 0;
  function norm(s) { return (s || "").toLowerCase().replace(/[ァ-ン]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); }); }
  function openSearch() { sp.hidden = false; si.value = ""; render(); si.focus(); }
  function closeSearch() { sp.hidden = true; }
  function render() {
    var q = norm(si.value.trim());
    var words = q.split(/\s+/).filter(Boolean);
    var data = window.TM_SEARCH || [];
    var hits = [];
    if (!words.length) {
      sh.innerHTML = '<div class="search-tip">例：「カット　戻す」「Timed out」「BGM」「マイスタイル」「Windows　入れかた」</div>';
      return;
    }
    data.forEach(function (d) {
      var hay = norm(d.t + " " + d.h + " " + d.x), score = 0, ok = true;
      words.forEach(function (w) { var i = hay.indexOf(w); if (i < 0) ok = false; else score += (norm(d.h).indexOf(w) >= 0 ? 5 : 0) + (norm(d.t).indexOf(w) >= 0 ? 3 : 0) + 1; });
      if (ok) hits.push({ d: d, s: score });
    });
    hits.sort(function (a, b) { return b.s - a.s; });
    sel = 0;
    sh.innerHTML = hits.slice(0, 30).map(function (h, i) {
      var d = h.d, x = d.x, w = words[0], i0 = norm(x).indexOf(w);
      var ex = i0 >= 0 ? x.slice(Math.max(0, i0 - 30), i0 + 70) : x.slice(0, 90);
      ex = ex.replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; });
      words.forEach(function (w) { if (w) ex = ex.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), function (m) { return "<mark>" + m + "</mark>"; }); });
      return '<a href="' + d.p + ".html" + (d.a ? "#" + d.a : "") + '"' + (i === 0 ? ' class="sel"' : "") + "><small>" + d.t + "</small>" + (d.h || d.t) + '<div class="ex">…' + ex + "…</div></a>";
    }).join("") || '<div class="search-tip">見つかりませんでした。別の言葉で試すか、「困ったとき」のページを見てください。</div>';
  }
  $(".search-btn").addEventListener("click", openSearch);
  si.addEventListener("input", render);
  sp.addEventListener("mousedown", function (e) { if (e.target === sp) closeSearch(); });
  addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); return; }
    if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); return; }
    if (sp.hidden) return;
    var items = $$("a", sh);
    if (e.key === "Escape") closeSearch();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length);
      items.forEach(function (a, i) { a.classList.toggle("sel", i === sel); }); if (items[sel]) items[sel].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && items[sel]) { location.href = items[sel].href; }
  });
  window.TM = { toast: toast, store: store };
})();
