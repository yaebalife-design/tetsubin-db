/**
 * お問い合わせの受信箱（運営者だけが見るページ） https://tetsubin-db.com/inbox
 *
 * ■ なぜこうしたか
 *   「一切メールアドレスとかばれないように」という条件を最も強く満たすため、
 *   メールを使わない構成にした。問い合わせは D1 に貯まり、ここで読む。
 *   システムのどこにも宛先アドレスが存在しない。
 *
 * ■ 保護
 *   環境変数 INBOX_PASSWORD と照合する。合っていれば署名付きCookieを発行する。
 *   ・パスワード比較は長さと中身を一定時間で比べる（早期returnしない）
 *   ・Cookie は HMAC-SHA256 で署名し、有効期限を含める。改ざんできない
 *   ・Cookie は HttpOnly / Secure / SameSite=Strict、パスは /inbox に限定
 *   ・noindex。robots.txt でも /inbox を拒否している
 *
 * ■ Cloudflare 側の設定
 *   D1 バインディング DB
 *   環境変数 INBOX_PASSWORD  … ログイン用（シークレット推奨）
 *   環境変数 INBOX_SECRET    … Cookie署名用（シークレット推奨。長いランダム文字列）
 */

const COOKIE = "tetsubin_inbox";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

/** 早期returnしない比較。入力の長さから正解の長さが分かってしまうのを避ける */
function slowEquals(a, b) {
  const A = enc.encode(String(a));
  const B = enc.encode(String(b));
  let diff = A.length ^ B.length;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) diff |= (A[i] || 0) ^ (B[i] || 0);
  return diff === 0;
}

async function makeToken(secret) {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${await hmac(secret, exp)}`;
}

async function validToken(secret, token) {
  if (!token || token.indexOf(".") < 0) return false;
  const i = token.indexOf(".");
  const exp = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return slowEquals(sig, await hmac(secret, exp));
}

function getCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function page(title, body, extraHead) {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
:root{--green:#a06a35;--green-dark:#14110e;--gold:#b8975c;--gold-deep:#8b6f3f;
  --rose:#c97b63;--line:#e8e3d4;--sub:#6b6b6b;--bg:#faf8f3;--paper:#fff;--ink:#1a1a1a}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter','Noto Sans JP',-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;
  background:var(--bg);color:var(--ink);line-height:1.75;padding:24px 16px 80px}
.wrap{max-width:960px;margin:0 auto}
h1{font-size:22px;margin-bottom:4px}
.sub{font-size:12.5px;color:var(--sub);margin-bottom:22px}
.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:18px}
.tab{font-size:13px;font-weight:700;padding:8px 14px;border-radius:999px;border:1px solid var(--line);
  background:var(--paper);color:var(--green-dark);text-decoration:none}
.tab.on{background:var(--green-dark);color:#fff;border-color:var(--green-dark)}
.count{margin-left:auto;font-size:13px;color:var(--sub)}
.msg{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:12px}
.msg.new{border-left:4px solid var(--gold)}
.msg.done{opacity:.62}
.meta{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--sub);margin-bottom:8px;align-items:center}
.kind{font-weight:700;color:#fff;background:var(--green-dark);border-radius:5px;padding:2px 9px;font-size:11.5px}
.body{white-space:pre-wrap;word-break:break-word;font-size:14.5px;margin:10px 0 12px}
.kv{font-size:12.5px;color:var(--sub);margin-bottom:2px}
.kv b{color:var(--ink);font-weight:600}
.kv a{color:var(--green)}
.act{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
button,.btn{appearance:none;font:inherit;font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:8px;
  border:1px solid var(--line);background:var(--paper);color:var(--green-dark);cursor:pointer;min-height:38px}
button:hover{border-color:var(--gold)}
button.danger{color:#8d4633;border-color:#e3c4ba}
.empty{background:var(--paper);border:1px dashed var(--line);border-radius:12px;padding:44px 20px;text-align:center;color:var(--sub)}
form.login{max-width:380px;margin:14vh auto 0;background:var(--paper);border:1px solid var(--line);
  border-radius:14px;padding:28px 26px}
form.login h1{font-size:19px;margin-bottom:6px}
form.login p{font-size:12.5px;color:var(--sub);margin-bottom:18px}
input[type=password]{width:100%;font:inherit;font-size:16px;padding:12px 14px;border:1.5px solid var(--line);
  border-radius:10px;margin-bottom:12px}
input[type=password]:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(184,151,92,.16)}
.submit{width:100%;background:var(--green-dark);color:#fff;border:0;padding:14px;font-size:15px;min-height:48px}
.err{background:rgba(201,123,99,.1);border:1px solid var(--rose);color:#8d4633;font-size:13px;
  font-weight:700;padding:11px 14px;border-radius:9px;margin-bottom:14px}
@media(max-width:600px){ .count{width:100%;margin-left:0} }
</style>${extraHead || ""}</head><body><div class="wrap">${body}</div></body></html>`;
}

function html(status, body, headers) {
  return new Response(body, {
    status,
    headers: Object.assign({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    }, headers || {}),
  });
}

function loginPage(error) {
  return page("受信箱｜南部鉄瓶-DB", `
  <form class="login" method="POST">
    <h1>南部鉄瓶-DB 受信箱</h1>
    <p>お問い合わせを読むページです。</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ""}
    <input type="password" name="password" placeholder="パスワード" autocomplete="current-password" autofocus required>
    <input type="hidden" name="action" value="login">
    <button class="submit" type="submit">開く</button>
  </form>`);
}

function notConfigured() {
  return html(503, page("受信箱｜南部鉄瓶-DB", `
    <form class="login">
      <h1>準備中</h1>
      <p>受信箱がまだ設定されていません。<br>
      Cloudflare 側で D1 バインディング <code>DB</code> と、環境変数
      <code>INBOX_PASSWORD</code> / <code>INBOX_SECRET</code> を設定してください。</p>
    </form>`));
}

function renderList(rows, view, counts) {
  const items = rows.map((r) => {
    const done = r.status === "done";
    return `<div class="msg ${done ? "done" : "new"}">
      <div class="meta">
        <span class="kind">${esc(r.kind)}</span>
        <span>${esc((r.at || "").replace("T", " ").slice(0, 16))} UTC</span>
        ${r.country ? `<span>${esc(r.country)}</span>` : ""}
        <span>#${r.id}</span>
      </div>
      ${r.name ? `<div class="kv">お名前: <b>${esc(r.name)}</b></div>` : ""}
      ${r.email ? `<div class="kv">返信先: <b>${esc(r.email)}</b></div>` : `<div class="kv">返信先: （未記入・返信不要）</div>`}
      ${r.url ? `<div class="kv">対象: <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></div>` : ""}
      <div class="body">${esc(r.message)}</div>
      <form class="act" method="POST">
        <input type="hidden" name="id" value="${r.id}">
        <button type="submit" name="action" value="${done ? "reopen" : "done"}">${done ? "未対応に戻す" : "対応済みにする"}</button>
        <button type="submit" name="action" value="delete" class="danger"
          onclick="return confirm('この問い合わせを完全に削除します。よろしいですか？')">削除</button>
      </form>
    </div>`;
  }).join("");

  return page("受信箱｜南部鉄瓶-DB", `
  <h1>南部鉄瓶-DB 受信箱</h1>
  <p class="sub">tetsubin-db.com のお問い合わせフォームに届いたものです。メールは使っていません。</p>
  <div class="bar">
    <a class="tab ${view === "new" ? "on" : ""}" href="/inbox">未対応 ${counts.newCount}</a>
    <a class="tab ${view === "all" ? "on" : ""}" href="/inbox?view=all">すべて ${counts.total}</a>
    <span class="count">${rows.length} 件を表示</span>
  </div>
  ${rows.length ? items : `<div class="empty">${view === "new" ? "未対応の問い合わせはありません。" : "まだ問い合わせは届いていません。"}</div>`}
  <form method="POST" style="margin-top:26px;">
    <button type="submit" name="action" value="logout">ログアウト</button>
  </form>`);
}

async function loadCounts(env) {
  const a = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages").first();
  const b = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'new'").first();
  return { total: (a && a.n) || 0, newCount: (b && b.n) || 0 };
}

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/inbox; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export async function onRequest({ request, env }) {
  if (!env.DB || !env.INBOX_PASSWORD || !env.INBOX_SECRET) return notConfigured();

  const url = new URL(request.url);
  const authed = await validToken(env.INBOX_SECRET, getCookie(request, COOKIE));

  if (request.method === "POST") {
    let form;
    try {
      form = await request.formData();
    } catch (e) {
      return html(400, loginPage("送信内容を読み取れませんでした。"));
    }
    const action = String(form.get("action") || "");

    if (action === "login") {
      if (slowEquals(form.get("password") || "", env.INBOX_PASSWORD)) {
        const token = await makeToken(env.INBOX_SECRET);
        return html(303, "", {
          location: "/inbox",
          "set-cookie": cookieHeader(encodeURIComponent(token), Math.floor(TTL_MS / 1000)),
        });
      }
      // 総当たりを遅くする
      await new Promise((r) => setTimeout(r, 1200));
      return html(401, loginPage("パスワードが違います。"));
    }

    if (!authed) return html(401, loginPage("もう一度ログインしてください。"));

    if (action === "logout") {
      return html(303, "", { location: "/inbox", "set-cookie": cookieHeader("", 0) });
    }

    const id = Number(form.get("id"));
    if (Number.isInteger(id) && id > 0) {
      if (action === "done") {
        await env.DB.prepare("UPDATE messages SET status = 'done' WHERE id = ?1").bind(id).run();
      } else if (action === "reopen") {
        await env.DB.prepare("UPDATE messages SET status = 'new' WHERE id = ?1").bind(id).run();
      } else if (action === "delete") {
        await env.DB.prepare("DELETE FROM messages WHERE id = ?1").bind(id).run();
      }
    }
    const back = url.searchParams.get("view") === "all" ? "/inbox?view=all" : "/inbox";
    return html(303, "", { location: back });
  }

  if (!authed) return html(200, loginPage(""));

  const view = url.searchParams.get("view") === "all" ? "all" : "new";
  const q = view === "all"
    ? "SELECT * FROM messages ORDER BY id DESC LIMIT 200"
    : "SELECT * FROM messages WHERE status = 'new' ORDER BY id DESC LIMIT 200";
  const res = await env.DB.prepare(q).all();
  const counts = await loadCounts(env);
  return html(200, renderList(res.results || [], view, counts));
}
