// Per-tool install + auth recipes. Edit here when adding or updating a
// tool. Each recipe declares:
//   - which binary(ies) on PATH mean "installed"
//   - per-OS ordered install plans (runner picks first manager present)
//   - optional `authCheck` + `authLogin` for OAuth/device flows
//   - optional docs URL shown on failure
//
// Platform coverage goals per tool:
//   darwin  -> brew always; npm as portable fallback where the tool ships on npm
//   linux   -> distro pkg manager + upstream binary/repo script for tools that
//              don't live in default repos (gh, supabase); user-land fallbacks
//              (npm, pipx) preferred when available
//   win32   -> winget (built-in on Win10+), scoop, choco, then npm
//
// When apt is used, we assume the tool's apt source is either already in
// sources.list.d or the pre-step adds it. The pre-step list is ordered
// and each command must exit 0; if any fails, the runner falls through
// to the next candidate manager.
import type { Recipe } from "./ensure.js";

const gh: Recipe = {
  name: "gh",
  describe: "GitHub CLI",
  bins: ["gh"],
  docs: "https://github.com/cli/cli#installation",
  steps: {
    darwin: [
      { manager: "brew", argv: ["brew", "install", "gh"] },
    ],
    linux: [
      { manager: "dnf", argv: ["sudo", "dnf", "install", "-y", "gh"], pre: [
        ["sudo", "dnf", "install", "-y", "dnf-command(config-manager)"],
        ["sudo", "dnf", "config-manager", "--add-repo", "https://cli.github.com/packages/rpm/gh-cli.repo"],
      ] },
      { manager: "pacman", argv: ["sudo", "pacman", "-S", "--noconfirm", "github-cli"] },
      { manager: "apt", argv: ["sudo", "apt-get", "install", "-y", "gh"], pre: [
        ["sudo", "mkdir", "-p", "-m", "755", "/etc/apt/keyrings"],
        ["bash", "-c", "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg"],
        ["bash", "-c", "echo \"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null"],
        ["sudo", "apt-get", "update"],
      ] },
    ],
    win32: [
      { manager: "winget", argv: ["winget", "install", "--id", "GitHub.cli", "-e", "--silent"] },
      { manager: "scoop", argv: ["scoop", "install", "gh"] },
      { manager: "choco", argv: ["choco", "install", "-y", "gh"] },
    ],
  },
  authCheck: { argv: ["gh", "auth", "status"], successPattern: /Logged in to/i },
  authLogin: {
    argv: ["gh", "auth", "login", "--web", "--git-protocol", "https"],
    notes: "follow the one-time device code in your browser; this terminal will unblock once GitHub confirms the login",
  },
};

const vercel: Recipe = {
  name: "vercel",
  describe: "Vercel CLI",
  bins: ["vercel"],
  docs: "https://vercel.com/docs/cli",
  steps: {
    // Vercel is distributed on npm for every platform. That's the
    // upstream-supported path, so we don't diverge per OS.
    darwin: [{ manager: "npm", argv: ["npm", "install", "-g", "vercel"] }],
    linux: [{ manager: "npm", argv: ["npm", "install", "-g", "vercel"] }],
    win32: [
      { manager: "npm", argv: ["npm", "install", "-g", "vercel"] },
      { manager: "scoop", argv: ["scoop", "install", "vercel-cli"] },
    ],
  },
  authCheck: { argv: ["vercel", "whoami"] },
  authLogin: {
    argv: ["vercel", "login"],
    notes: "pick a login method (GitHub/GitLab/Email); confirm in browser or email",
  },
};

const supabase: Recipe = {
  name: "supabase",
  describe: "Supabase CLI",
  bins: ["supabase"],
  docs: "https://supabase.com/docs/guides/local-development/cli/getting-started",
  steps: {
    darwin: [
      { manager: "brew", argv: ["brew", "install", "supabase/tap/supabase"] },
    ],
    linux: [
      { manager: "brew", argv: ["brew", "install", "supabase/tap/supabase"] },
      // Linux-pkg install is not officially supported; brew via homebrew-on-linux is Supabase's recommended path.
    ],
    win32: [
      { manager: "scoop", argv: ["scoop", "install", "supabase"], pre: [
        ["scoop", "bucket", "add", "supabase", "https://github.com/supabase/scoop-bucket.git"],
      ] },
    ],
  },
  authCheck: { argv: ["supabase", "projects", "list"] },
  authLogin: {
    argv: ["supabase", "login"],
    notes: "paste the access token from https://supabase.com/dashboard/account/tokens",
  },
};

const ffmpeg: Recipe = {
  name: "ffmpeg",
  describe: "FFmpeg (video/audio toolkit)",
  bins: ["ffmpeg"],
  docs: "https://ffmpeg.org/download.html",
  steps: {
    darwin: [{ manager: "brew", argv: ["brew", "install", "ffmpeg"] }],
    linux: [
      { manager: "apt", argv: ["sudo", "apt-get", "install", "-y", "ffmpeg"], pre: [["sudo", "apt-get", "update"]] },
      { manager: "dnf", argv: ["sudo", "dnf", "install", "-y", "ffmpeg"] },
      { manager: "pacman", argv: ["sudo", "pacman", "-S", "--noconfirm", "ffmpeg"] },
    ],
    win32: [
      { manager: "winget", argv: ["winget", "install", "--id", "Gyan.FFmpeg", "-e", "--silent"] },
      { manager: "scoop", argv: ["scoop", "install", "ffmpeg"] },
      { manager: "choco", argv: ["choco", "install", "-y", "ffmpeg"] },
    ],
  },
};

const ytdlp: Recipe = {
  name: "yt-dlp",
  describe: "yt-dlp (YouTube + generic downloader)",
  bins: ["yt-dlp"],
  docs: "https://github.com/yt-dlp/yt-dlp/wiki/Installation",
  steps: {
    darwin: [
      { manager: "brew", argv: ["brew", "install", "yt-dlp"] },
      { manager: "pipx", argv: ["pipx", "install", "yt-dlp"] },
    ],
    linux: [
      { manager: "pipx", argv: ["pipx", "install", "yt-dlp"] },
      { manager: "apt", argv: ["sudo", "apt-get", "install", "-y", "yt-dlp"], pre: [["sudo", "apt-get", "update"]] },
      { manager: "dnf", argv: ["sudo", "dnf", "install", "-y", "yt-dlp"] },
      { manager: "pacman", argv: ["sudo", "pacman", "-S", "--noconfirm", "yt-dlp"] },
    ],
    win32: [
      { manager: "winget", argv: ["winget", "install", "--id", "yt-dlp.yt-dlp", "-e", "--silent"] },
      { manager: "scoop", argv: ["scoop", "install", "yt-dlp"] },
      { manager: "choco", argv: ["choco", "install", "-y", "yt-dlp"] },
      { manager: "pipx", argv: ["pipx", "install", "yt-dlp"] },
    ],
  },
};

const tesseract: Recipe = {
  name: "tesseract",
  describe: "Tesseract OCR engine",
  bins: ["tesseract"],
  docs: "https://tesseract-ocr.github.io/tessdoc/Installation.html",
  steps: {
    darwin: [{ manager: "brew", argv: ["brew", "install", "tesseract"] }],
    linux: [
      { manager: "apt", argv: ["sudo", "apt-get", "install", "-y", "tesseract-ocr"], pre: [["sudo", "apt-get", "update"]] },
      { manager: "dnf", argv: ["sudo", "dnf", "install", "-y", "tesseract"] },
      { manager: "pacman", argv: ["sudo", "pacman", "-S", "--noconfirm", "tesseract"] },
    ],
    win32: [
      { manager: "winget", argv: ["winget", "install", "--id", "UB-Mannheim.TesseractOCR", "-e", "--silent"] },
      { manager: "choco", argv: ["choco", "install", "-y", "tesseract"] },
      { manager: "scoop", argv: ["scoop", "install", "tesseract"] },
    ],
  },
};

const poppler: Recipe = {
  name: "poppler",
  describe: "Poppler PDF utilities (pdftotext, pdfimages, pdftoppm)",
  bins: ["pdftotext"],
  docs: "https://poppler.freedesktop.org/",
  steps: {
    darwin: [{ manager: "brew", argv: ["brew", "install", "poppler"] }],
    linux: [
      { manager: "apt", argv: ["sudo", "apt-get", "install", "-y", "poppler-utils"], pre: [["sudo", "apt-get", "update"]] },
      { manager: "dnf", argv: ["sudo", "dnf", "install", "-y", "poppler-utils"] },
      { manager: "pacman", argv: ["sudo", "pacman", "-S", "--noconfirm", "poppler"] },
    ],
    win32: [
      { manager: "winget", argv: ["winget", "install", "--id", "oschwartz10612.Poppler", "-e", "--silent"] },
      { manager: "scoop", argv: ["scoop", "install", "poppler"] },
      { manager: "choco", argv: ["choco", "install", "-y", "poppler"] },
    ],
  },
};

export const RECIPES: Recipe[] = [gh, vercel, supabase, ffmpeg, ytdlp, tesseract, poppler];
