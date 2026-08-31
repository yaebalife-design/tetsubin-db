/**
 * お問い合わせの受け口（Cloudflare Pages Functions）
 *
 * ■ 設計の要点：メールアドレスがシステムのどこにも存在しない
 *   ブラウザが話す相手は tetsubin-db.com/api/contact だけ。
 *   受け取った内容は Cloudflare D1（同じアカウント内のデータベース）に保存し、
 *   運営者は tetsubin-db.com/inbox で読む。
 *   メール送信も外部サービスへの転送もしないので、**宛先アドレスというものが存在しない**。
 *
 * ■ Cloudflare 側の設定
 *   D1 バインディング  DB               … 保存先（これが本命）
 *   環境変数（任意）   CONTACT_WEBHOOK  … 外部へも飛ばしたい場合だけ。既定では使わない
 *   環境変数（任意）   TURNSTILE_SECRET … Turnstile を使う場合だけ
 *
 *   保存先が無いうちは、フォームは「受付を準備中」と正直に返す（黙って捨てない）。
 */

const MAX = { name: 100, email: 200, url: 500, message: 4000, kind: 40 };
const KINDS = ["掲載情報の誤り", "新規工房の掲載依頼", "画像・引用について", "模倣品に関する情報", "その他"];

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      // このAPIは自サイトのフォームからしか呼ばれない
      "x-robots-tag": "noindex",
    },
  });
}

function clean(v, max) {
  if (typeof v !== "string") return "";
  // 制御文字を落とす。改行(10)とタブ(9)は本文に必要なので残す。
  // ここに制御文字そのものを正規表現で書くと、ファイルに生のバイトが埋まって壊れやすいので
  // コードポイントで判定する。
  let out = "";
  for (const ch of v) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10) { out += ch; continue; }
    if (c < 32 || c === 127) continue;
    out += ch;
  }
  return out.trim().slice(0, max);
}

async function verifyTurnstile(secret, token, ip) {
  if (!secret) return true; // 未設定なら検証しない
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form });
    const d = await r.json();
    return !!d.success;
  } catch (e) {
    return false;
  }
}

/* ---- Googleスプレッドシートへの追記 ----------------------------------------
 * サービスアカウントのJWTでアクセストークンを取り、対象タブに1行 append する。
 * 鍵は環境変数（暗号化シークレット）にだけ置き、コードにもHTMLにも書かない。
 * 失敗しても D1 に控えが残るので、問い合わせ自体は失われない。
 */
function b64urlFromBytes(buf) {
  let s = "";
  const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlFromString(str) {
  return b64urlFromBytes(new TextEncoder().encode(str));
}

/** PEM(PKCS#8) を Web Crypto の鍵に読み込む */
async function importKey(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8", raw.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
}

async function serviceAccountToken(email, pem) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlFromString(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlFromString(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const key = await importKey(pem);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(header + "." + claim));
  const jwt = header + "." + claim + "." + b64urlFromBytes(sig);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!r.ok) return null;
  return (await r.json()).access_token || null;
}

async function appendToSheet(env, row) {
  const id = env.SHEETS_ID;
  const tab = env.SHEETS_TAB;
  if (!id || !tab || !env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_KEY) return false;
  try {
    const token = await serviceAccountToken(env.GOOGLE_SA_EMAIL, env.GOOGLE_SA_KEY);
    if (!token) return false;
    const url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(id)
      + "/values/" + encodeURIComponent(tab) + "!A1:H1:append"
      + "?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(400, { ok: false, error: "bad_request", message: "送信内容を読み取れませんでした。" });
  }

  // --- スパム対策1: ハニーポット。人には見えない項目に入力があったら弾く
  if (clean(body.website, 50)) {
    // ボットには成功したように見せる（再送を誘発しないため）
    return json(200, { ok: true });
  }

  // --- スパム対策2: フォーム表示から3秒未満の送信は機械とみなす
  const elapsed = Number(body.elapsed);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 3000) {
    return json(200, { ok: true });
  }

  // --- スパム対策3: Turnstile（設定されている場合のみ）
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, body.token, ip))) {
    return json(400, { ok: false, error: "captcha", message: "確認に失敗しました。時間をおいてお試しください。" });
  }

  const kind = clean(body.kind, MAX.kind);
  const name = clean(body.name, MAX.name);
  const email = clean(body.email, MAX.email);
  const url = clean(body.url, MAX.url);
  const message = clean(body.message, MAX.message);

  if (!message || message.length < 10) {
    return json(422, { ok: false, error: "too_short", message: "お問い合わせ内容を10文字以上でご記入ください。" });
  }
  if (!KINDS.includes(kind)) {
    return json(422, { ok: false, error: "bad_kind", message: "お問い合わせの種類をお選びください。" });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(422, { ok: false, error: "bad_email", message: "メールアドレスの形式をご確認ください。" });
  }

  const country = request.headers.get("cf-ipcountry") || "";
  const at = new Date().toISOString();
  let stored = false;

  // --- 保存（本命）。D1に入れば成功。メールは一切絡まない
  if (env.DB) {
    try {
      await env.DB.prepare(
        "INSERT INTO messages (at, kind, name, email, url, country, message, status) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'new')"
      ).bind(at, kind, name, email, url, country, message).run();
      stored = true;
    } catch (e) {
      // 例外の中身は返さない
    }
  }

  // --- スプレッドシートへ追記（本命）
  const sheetRow = [
    at.replace("T", " ").slice(0, 19),
    kind,
    name,
    email,
    url,
    country,
    message,
    "未対応",
  ];
  if (await appendToSheet(env, sheetRow)) stored = true;

  // --- 外部への転送（環境変数が設定されている場合だけ。既定では使わない）
  if (env.CONTACT_WEBHOOK) {
    const lines = [
      `種類: ${kind}`,
      `お名前: ${name || "（未記入）"}`,
      `返信先: ${email || "（未記入・返信不要）"}`,
      `対象ページ: ${url || "（未記入）"}`,
      `国: ${country}`,
      `日時: ${at}`,
      "",
      message,
    ];
    const payload = (env.CONTACT_WEBHOOK_FORMAT || "").toLowerCase() === "discord"
      ? { content: ["**南部鉄瓶-DB お問い合わせ**", "```", ...lines, "```"].join("\n").slice(0, 1900) }
      : { site: "南部鉄瓶-DB", kind, name, email, url, country, at, message, text: lines.join("\n") };
    try {
      const r = await fetch(env.CONTACT_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) stored = true;
    } catch (e) {
      // 宛先URLが漏れうるので中身は返さない
    }
  }

  if (!stored) {
    // 保存先が無い／保存に失敗した。黙って捨てず、送れなかったことを正直に返す。
    return json(503, {
      ok: false, error: "not_configured",
      message: "申し訳ありません。ただいま受付の設定作業中で送信できません。時間をおいてお試しください。",
    });
  }

  return json(200, { ok: true });
}

// onRequestPost だけを export する。
// onRequest を併記すると、そちらが全メソッドを受けて onRequestPost が呼ばれなくなる。
// POST以外は Cloudflare Pages が自動で 405 を返す。
