// Small shared helpers.
import { execFile } from "node:child_process";

// Open a URL in the user's default browser, cross-platform.
export function openUrl(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { execFile(opener, [url], () => {}); return true; } catch { return false; }
}
