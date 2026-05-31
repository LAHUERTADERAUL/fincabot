const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "app.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
const usedIds = new Set([...js.matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]));
const missingIds = [...usedIds].filter((id) => !ids.has(id));

const views = [...html.matchAll(/id="view-([^"]+)"/g)].map((match) => match[1]);
const navs = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
const missingViews = [...new Set(navs)].filter((view) => !views.includes(view));

const expectedFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "icon.svg",
  "sw.js",
  "cloud-config.js",
  "supabase.schema.sql"
];
const missingAssets = expectedFiles.filter((file) => !fs.existsSync(path.join(root, file)));
const swAssets = [...sw.matchAll(/"\.\/([^"]+)"/g)].map((match) => match[1]).filter(Boolean);
const swMissing = swAssets.filter((file) => !fs.existsSync(path.join(root, file)));

const result = {
  missingIds,
  missingViews,
  missingAssets,
  swMissing,
  manifestName: manifest.name,
  checkedFiles: expectedFiles.length
};

console.log(JSON.stringify(result, null, 2));

if (missingIds.length || missingViews.length || missingAssets.length || swMissing.length) {
  process.exitCode = 2;
}
