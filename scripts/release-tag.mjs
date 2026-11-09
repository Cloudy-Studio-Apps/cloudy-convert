// Starts a release: `pnpm release:tag 0.2.0` writes the version everywhere it's kept, commits it,
// tags it `v0.2.0` and pushes both. The tag starts `.github/workflows/release.yml`, which builds
// every package into a draft release and publishes it once every build passed.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail("Usage: pnpm release:tag <version>, e.g. pnpm release:tag 0.2.0");
}
const tag = `v${version}`;

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (git("branch", "--show-current") !== "master") fail("Release from the master branch.");
if (git("status", "--porcelain") !== "") fail("Commit or stash your changes first.");
if (git("tag", "--list", tag) !== "") fail(`The tag ${tag} already exists.`);

/** Replaces the one match of `pattern` in a file, failing when there's none. */
function replaceIn(path, pattern, replacement) {
  const text = readFileSync(path, "utf8");
  if (!pattern.test(text)) fail(`Couldn't find the version in ${path}.`);
  writeFileSync(path, text.replace(pattern, replacement));
}

replaceIn("package.json", /^(  "version": ")[^"]+(",)$/m, `$1${version}$2`);
replaceIn("src-tauri/tauri.conf.json", /^(  "version": ")[^"]+(",)$/m, `$1${version}$2`);
replaceIn("src-tauri/Cargo.toml", /^(version = ")[^"]+(")$/m, `$1${version}$2`);
replaceIn(
  "src-tauri/Cargo.lock",
  /(name = "cloudy-convert"\nversion = ")[^"]+(")/,
  `$1${version}$2`,
);

const files = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];
git("add", ...files);
git("commit", "-m", `Release ${tag}`);
git("tag", "-a", tag, "-m", `Cloudy Convert ${tag}`);
git("push", "origin", "master", tag);

console.log(
  `Pushed ${tag}. GitHub Actions is building it, and publishes it once every build passed:`,
);
console.log("https://github.com/Cloudy-Studio-Apps/cloudy-convert/actions");

function fail(message) {
  console.error(message);
  process.exit(1);
}
