self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.startsWith("/__fdv-file/")) {
    event.respondWith(handleFileRequest(event));
    return;
  }
  event.respondWith(fetch(event.request));
});

const fileRegistry = new Map();

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader) {
    return null;
  }
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    return null;
  }
  const startText = match[1];
  const endText = match[2];
  let start = startText ? Number(startText) : null;
  let end = endText ? Number(endText) : null;

  if (Number.isNaN(start)) {
    start = null;
  }
  if (Number.isNaN(end)) {
    end = null;
  }

  if (start === null && end === null) {
    return null;
  }

  if (start === null) {
    const suffixLength = end ?? 0;
    if (suffixLength <= 0) {
      return null;
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    if (end === null || end >= size) {
      end = size - 1;
    }
  }

  if (start < 0 || start >= size || start > end) {
    return null;
  }

  return { start, end };
}

function buildFileHeaders(file, size, range = null) {
  const headers = new Headers();
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Type", file.type || "application/octet-stream");
  headers.set("Cache-Control", "no-store");
  if (range) {
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${size}`,
    );
    headers.set("Content-Length", String(range.end - range.start + 1));
  } else {
    headers.set("Content-Length", String(size));
  }
  return headers;
}

async function handleFileRequest(event) {
  const requestUrl = new URL(event.request.url);
  const fileId = requestUrl.pathname.replace("/__fdv-file/", "");
  const entry = fileRegistry.get(fileId);
  if (!entry) {
    return new Response("File not found.", { status: 404 });
  }

  const { file } = entry;
  const size = file.size ?? 0;
  const rangeHeader = event.request.headers.get("Range");
  const range = parseRangeHeader(rangeHeader, size);

  if (rangeHeader && !range) {
    const headers = buildFileHeaders(file, size);
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  if (event.request.method === "HEAD") {
    const headers = buildFileHeaders(file, size, range);
    return new Response(null, {
      status: range ? 206 : 200,
      headers,
    });
  }

  if (range) {
    const slice = file.slice(range.start, range.end + 1);
    return new Response(slice, {
      status: 206,
      headers: buildFileHeaders(file, size, range),
    });
  }

  return new Response(file, {
    status: 200,
    headers: buildFileHeaders(file, size),
  });
}

self.addEventListener("message", (event) => {
  const { data } = event;
  if (!data || typeof data !== "object") {
    return;
  }

  if (data.type === "FDV_REGISTER_FILE") {
    const file = data.file;
    if (!file) {
      event.ports?.[0]?.postMessage({
        error: { message: "No file provided." },
      });
      return;
    }
    const id = crypto.randomUUID();
    fileRegistry.set(id, { file });
    event.ports?.[0]?.postMessage({
      result: { id, url: `/__fdv-file/${id}` },
    });
    return;
  }

  if (data.type === "FDV_UNREGISTER_FILE" && data.id) {
    fileRegistry.delete(data.id);
  }
});
