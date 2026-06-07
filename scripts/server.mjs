import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const port = Number(Bun.env.PORT || 5173);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xls": "application/vnd.ms-excel",
};

function safeFilePath(url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(root, normalized));
  return filePath.startsWith(root) ? filePath : null;
}

Bun.serve({
  port,
  async fetch(request) {
    const filePath = safeFilePath(request.url);
    if (!filePath) return new Response("Forbidden", { status: 403 });

    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });

    return new Response(file, {
      headers: {
        "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      },
    });
  },
});

console.log(`Gaokao atlas running at http://localhost:${port}/`);
