const OPFS_DIR = "fdv-files";

export function isOpfsSupported() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function"
  );
}

function encodeKey(value) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeKey(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = atob(padded);
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function buildFileName(fileKey) {
  return `${encodeKey(fileKey)}.h5`;
}

function buildMetadataName(fileKey) {
  return `${encodeKey(fileKey)}.metadata.json`;
}

function decodeFileKeyFromName(name) {
  if (!name || !name.endsWith(".h5")) {
    return null;
  }
  const baseName = name.slice(0, -3);
  try {
    return decodeKey(baseName);
  } catch (error) {
    return null;
  }
}

async function getOpfsDirectory() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

export async function listOpfsFiles() {
  if (!isOpfsSupported()) {
    return [];
  }

  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(OPFS_DIR);
    const entries = [];
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind !== "file") {
        continue;
      }
      let size = null;
      let lastModified = null;
      try {
        const file = await handle.getFile();
        size = file.size;
        lastModified = file.lastModified;
      } catch (error) {
        // Ignore metadata failures; we still want the file name.
      }
      entries.push({ name, size, lastModified });
    }
    return entries;
  } catch (error) {
    return [];
  }
}

export async function listOpfsFileKeys() {
  const entries = await listOpfsFiles();
  const resolved = await Promise.all(
    entries.map(async (entry) => {
      const fileKey = decodeFileKeyFromName(entry.name);
      if (!fileKey) {
        return null;
      }
      const metadata = await loadOpfsMetadata(fileKey);
      return {
        fileKey,
        name: entry.name,
        size: entry.size,
        lastModified: entry.lastModified,
        displayName: metadata?.displayName ?? null,
      };
    }),
  );
  return resolved.filter(Boolean);
}

async function loadOpfsMetadata(fileKey) {
  try {
    const directory = await getOpfsDirectory();
    const fileHandle = await directory.getFileHandle(buildMetadataName(fileKey));
    const metadataFile = await fileHandle.getFile();
    return JSON.parse(await metadataFile.text());
  } catch (error) {
    return null;
  }
}

async function saveOpfsMetadata(fileKey, metadata) {
  const directory = await getOpfsDirectory();
  const fileHandle = await directory.getFileHandle(buildMetadataName(fileKey), {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(metadata));
  await writable.close();
}

export async function saveFileToOpfs(fileKey, file, { displayName } = {}) {
  if (!isOpfsSupported() || !fileKey || !file) {
    return false;
  }

  try {
    const directory = await getOpfsDirectory();
    const fileHandle = await directory.getFileHandle(buildFileName(fileKey), {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
    if (typeof displayName === "string") {
      await saveOpfsMetadata(fileKey, { displayName });
    }
    return true;
  } catch (error) {
    console.warn("Unable to cache file in OPFS.", error);
    return false;
  }
}

export async function hasFileInOpfs(fileKey, { displayName } = {}) {
  if (!isOpfsSupported() || !fileKey) {
    return false;
  }

  try {
    const directory = await getOpfsDirectory();
    await directory.getFileHandle(buildFileName(fileKey));
    if (displayName) {
      const metadata = await loadOpfsMetadata(fileKey);
      if (!metadata || metadata.displayName !== displayName) {
        return false;
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

export async function loadFileFromOpfs(fileKey, { displayName } = {}) {
  if (!isOpfsSupported() || !fileKey) {
    return null;
  }

  try {
    if (displayName) {
      const metadata = await loadOpfsMetadata(fileKey);
      if (metadata?.displayName && metadata.displayName !== displayName) {
        return null;
      }
    }
    const directory = await getOpfsDirectory();
    const fileHandle = await directory.getFileHandle(buildFileName(fileKey));
    const file = await fileHandle.getFile();
    return file;
  } catch (error) {
    return null;
  }
}

export async function removeFileFromOpfs(fileKey) {
  if (!isOpfsSupported() || !fileKey) {
    return false;
  }

  try {
    const directory = await getOpfsDirectory();
    await directory.removeEntry(buildFileName(fileKey));
    try {
      await directory.removeEntry(buildMetadataName(fileKey));
    } catch (error) {
      return true;
    }
    return true;
  } catch (error) {
    console.warn("Unable to remove cached file from OPFS.", error);
    return false;
  }
}
