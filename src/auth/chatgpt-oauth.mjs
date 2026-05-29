// Native "Sign in with ChatGPT" via the Codex OAuth backend (PKCE).
// This is the same subscription-login mechanism Codex CLI uses; each user signs
// in with their OWN account. No OpenClaw, no pooling.
//
// Flow: PKCE authorize at auth.openai.com -> localhost callback -> token
// exchange -> store {access, refresh, account_id, expires}. Auto-refresh.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { saveCred, loadCred } from "./store.mjs";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"; // public Codex client id
const AUTHORIZE = "https://auth.openai.com/oauth/authorize";
const TOKEN = "https://auth.openai.com/oauth/token";
const REDIRECT = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";
export const PROVIDER = "openai-codex";

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pkce() {
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
export function authorizeUrl({ challenge, state }) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
  });
  return `${AUTHORIZE}?${q.toString()}`;
}

function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  } catch { return {}; }
}

// Pull the ChatGPT account id out of the id_token claims (used as a request header).
export function accountIdFromIdToken(idToken) {
  const c = decodeJwt(idToken);
  const auth = c["https://api.openai.com/auth"] || {};
  return auth.chatgpt_account_id || auth.user_id || c.organization_id || null;
}

async function exchange(code, verifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT,
    code_verifier: verifier,
  });
  const r = await fetch(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${await r.text()}`);
  return r.json();
}

function openBrowser(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(opener, [url], () => {});
}

function persist(tok) {
  const cred = {
    type: "oauth",
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    id_token: tok.id_token,
    account_id: accountIdFromIdToken(tok.id_token),
    expires_at: Date.now() + (tok.expires_in ? tok.expires_in * 1000 : 3600 * 1000),
  };
  saveCred(PROVIDER, cred);
  return cred;
}

// Run the interactive login. Returns the stored credential.
export function login({ timeoutMs = 300000, print = console.log } = {}) {
  const { verifier, challenge } = pkce();
  const state = b64url(randomBytes(16));
  const url = authorizeUrl({ challenge, state });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== "/auth/callback") { res.writeHead(404); return res.end(); }
      const code = u.searchParams.get("code");
      const retState = u.searchParams.get("state");
      if (!code || retState !== state) {
        res.writeHead(400, { "content-type": "text/html" });
        res.end("<h2>Sign-in failed</h2><p>You can close this tab and try again.</p>");
        cleanup(); return reject(new Error("missing code or state mismatch"));
      }
      try {
        const tok = await exchange(code, verifier);
        const cred = persist(tok);
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<h2>Signed in to BajaClaw</h2><p>You can close this tab and return to the terminal.</p>");
        cleanup(); resolve(cred);
      } catch (e) {
        res.writeHead(500, { "content-type": "text/html" });
        res.end("<h2>Token exchange failed</h2><p>Close this tab and try again.</p>");
        cleanup(); reject(e);
      }
    });
    const timer = setTimeout(() => { cleanup(); reject(new Error("sign-in timed out")); }, timeoutMs);
    function cleanup() { clearTimeout(timer); try { server.close(); } catch {} }

    server.on("error", (e) => { cleanup(); reject(e); });
    server.listen(1455, "127.0.0.1", () => {
      print(`Opening your browser to sign in with ChatGPT...`);
      print(`If it does not open, visit:\n${url}`);
      openBrowser(url);
    });
  });
}

// Return a valid access token, refreshing if near expiry.
export async function getAccessToken() {
  let cred = loadCred(PROVIDER);
  if (!cred) return null;
  if (cred.expires_at && cred.expires_at - Date.now() > 60000) return cred;
  if (!cred.refresh_token) return cred; // can't refresh; return as-is
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: cred.refresh_token,
      scope: SCOPE,
    });
    const r = await fetch(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    if (r.ok) {
      const tok = await r.json();
      cred = persist({ ...tok, refresh_token: tok.refresh_token || cred.refresh_token, id_token: tok.id_token || cred.id_token });
    }
  } catch { /* keep stale token; the request may still work briefly */ }
  return cred;
}
