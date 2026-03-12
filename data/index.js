// Data access layer for browser-side HDF5 access.
// TODO: Add lazy slicing support per ARCHITECTURE.md sections 4.2 and 4.3.

const HDF5_CDN_PRIMARY =
  "https://cdn.jsdelivr.net/npm/h5wasm@0.8.11/dist/iife/h5wasm.js";
const HDF5_CDN_FALLBACK =
  "https://unpkg.com/h5wasm@0.8.11/dist/iife/h5wasm.js";
const DEFAULT_MAX_FILE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_PREVIEW_POINTS = 100000;
const DEFAULT_MAX_PREVIEW_ROWS = 1000;
const DEFAULT_MAX_PREVIEW_COLS = 1000;
const MAX_FILE_BYTES = (() => {
  const configured = Number.parseInt(globalThis?.FDV_MAX_FILE_BYTES ?? "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_MAX_FILE_BYTES;
})();
const DEFAULT_ACCESS_MODE = "lazy";

export class FileTooLargeError extends Error {
  constructor(message, { size, maxBytes } = {}) {
    super(message);
    this.name = "FileTooLargeError";
    this.size = size;
    this.maxBytes = maxBytes;
  }
}

let cachedModulePromise;

function isArrayBufferAllocationError(error) {
  return (
    error instanceof RangeError &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("array buffer allocation failed")
  );
}

function resolveHdf5Global() {
  const globalValue = globalThis.h5wasm;

  if (!globalValue) {
    return null;
  }

  if (typeof globalValue === "function") {
    return {
      h5wasm: globalValue,
      File: globalValue.File,
      Group: globalValue.Group,
      Dataset: globalValue.Dataset,
    };
  }

  if (typeof globalValue?.h5wasm === "function") {
    return globalValue;
  }

  if (globalValue?.ready || globalValue?.File || globalValue?.Group || globalValue?.Dataset) {
    return globalValue;
  }

  if (typeof globalValue?.default?.h5wasm === "function") {
    return globalValue.default;
  }

  if (
    globalValue?.default?.ready ||
    globalValue?.default?.File ||
    globalValue?.default?.Group ||
    globalValue?.default?.Dataset
  ) {
    return globalValue.default;
  }

  return null;
}

function loadHdf5Script(url) {
  return new Promise((resolve, reject) => {
    const existingModule = resolveHdf5Global();
    if (existingModule) {
      resolve(existingModule);
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = url;
    script.onload = () => {
      const module = resolveHdf5Global();
      if (module) {
        resolve(module);
        return;
      }
      reject(new Error("HDF5 module loaded but no global export was found."));
    };
    script.onerror = () => {
      reject(new Error(`Failed to load HDF5 module from ${url}.`));
    };
    document.head.appendChild(script);
  });
}

async function loadHdf5Module() {
  if (!cachedModulePromise) {
    cachedModulePromise = loadHdf5Script(HDF5_CDN_PRIMARY).catch((error) => {
      console.warn("Primary HDF5 module load failed, using fallback.", error);
      return loadHdf5Script(HDF5_CDN_FALLBACK);
    });
  }

  return cachedModulePromise;
}

async function resolveHdf5ReadyModule(hdf5Module) {
  if (hdf5Module?.ready instanceof Promise) {
    return hdf5Module.ready;
  }

  if (hdf5Module?.h5wasm?.ready instanceof Promise) {
    return hdf5Module.h5wasm.ready;
  }

  return hdf5Module;
}

async function resolveHdf5Runtime(hdf5Module, readyModule) {
  if (typeof hdf5Module?.h5wasm === "function") {
    return hdf5Module.h5wasm();
  }

  if (readyModule?.FS) {
    return readyModule;
  }

  if (hdf5Module?.FS) {
    return hdf5Module;
  }

  if (readyModule?.h5wasm?.FS) {
    return readyModule.h5wasm;
  }

  return readyModule ?? hdf5Module;
}

async function readFileInput(fileOrHandle) {
  if (fileOrHandle instanceof File) {
    return fileOrHandle;
  }

  if (fileOrHandle?.getFile) {
    return fileOrHandle.getFile();
  }

  throw new Error("Unsupported file input. Use a File or FileSystemFileHandle.");
}

function normalizeAccessMode(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "metadata") {
    return "metadata";
  }
  if (normalized === "full") {
    return "full";
  }
  return DEFAULT_ACCESS_MODE;
}

function normalizePath(path) {
  if (!path || path === "/") {
    return "/";
  }

  return path.startsWith("/") ? path : `/${path}`;
}

const DEFAULT_NUMPY_DTYPE_BYTES = {
  i: 4,
  u: 4,
  f: 4,
  c: 8,
  b: 1,
};

function getDtypeByteSize(dtype) {
  if (!dtype || typeof dtype !== "object") {
    return null;
  }

  const candidates = [
    dtype.itemsize,
    dtype.byteSize,
    dtype.size,
    dtype.bytes,
    dtype.nbytes,
    dtype.byte_size,
  ];

  for (const candidate of candidates) {
    if (Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }

  return null;
}

function normalizeDtypeString(dtype, byteSize) {
  const dtypeString = String(dtype);
  const match = dtypeString.match(/^([<>|]?)([iufcb])(\d+)?$/i);
  if (!match) {
    return dtypeString;
  }

  const [, endian, kind, size] = match;
  if (size) {
    return `${endian}${kind}${size}`;
  }

  const fallback = DEFAULT_NUMPY_DTYPE_BYTES[kind.toLowerCase()];
  const resolvedSize =
    (Number.isFinite(byteSize) && byteSize > 0 ? byteSize : null) ?? fallback;

  return resolvedSize ? `${endian}${kind}${resolvedSize}` : dtypeString;
}

function describeDtype(dtype) {
  if (!dtype) {
    return "unknown";
  }

  if (typeof dtype === "string") {
    return normalizeDtypeString(dtype, getDtypeByteSize(dtype));
  }

  if (dtype.name) {
    return normalizeDtypeString(dtype.name, getDtypeByteSize(dtype));
  }

  if (dtype.constructor?.name) {
    return normalizeDtypeString(dtype.constructor.name, getDtypeByteSize(dtype));
  }

  return normalizeDtypeString(String(dtype), getDtypeByteSize(dtype));
}

export function isNumericDtype(dtype) {
  if (!dtype) {
    return false;
  }

  const normalized = String(dtype).toLowerCase();
  if (/^[<>|]?(?:[iuf]\d+|[fd]\d*|[bhlq]\d*)$/.test(normalized)) {
    return true;
  }

  if (
    normalized.includes("int") ||
    normalized.includes("float") ||
    normalized.includes("double")
  ) {
    return true;
  }

  return false;
}

function formatAttributeValue(value) {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatAttributeValue(entry)).join(", ")}]`;
  }

  if (ArrayBuffer.isView(value)) {
    return `[${Array.from(value).join(", ")}]`;
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function extractAttributes(node) {
  const attrs = node?.attrs;
  if (!attrs) {
    return [];
  }

  const entries = [];

  if (typeof attrs.keys === "function") {
    for (const key of attrs.keys()) {
      const rawValue = typeof attrs.get === "function" ? attrs.get(key) : attrs[key];
      entries.push({ key, value: formatAttributeValue(rawValue) });
    }
  } else {
    for (const [key, rawValue] of Object.entries(attrs)) {
      entries.push({ key, value: formatAttributeValue(rawValue) });
    }
  }

  return entries;
}

function deferToEventLoop() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function getShape(node) {
  if (Array.isArray(node?.shape)) {
    return node.shape;
  }

  if (ArrayBuffer.isView(node?.shape)) {
    return Array.from(node.shape);
  }

  if (Array.isArray(node?.dims)) {
    return node.dims;
  }

  if (ArrayBuffer.isView(node?.dims)) {
    return Array.from(node.dims);
  }

  if (Array.isArray(node?.dimensions)) {
    return node.dimensions;
  }

  if (ArrayBuffer.isView(node?.dimensions)) {
    return Array.from(node.dimensions);
  }

  if (node?.shape && typeof node.shape.length === "number") {
    return Array.from(node.shape);
  }

  return null;
}

function getNodeType(node, groupCtor, datasetCtor) {
  if (groupCtor && node instanceof groupCtor) {
    return "group";
  }

  if (datasetCtor && node instanceof datasetCtor) {
    return "dataset";
  }

  if (node?.type === "group" || node?.isGroup) {
    return "group";
  }

  if (node?.type === "dataset" || node?.isDataset) {
    return "dataset";
  }

  return "unknown";
}

function listNodeChildren(node, path, groupCtor, datasetCtor) {
  if (!node?.keys || typeof node.keys !== "function") {
    return [];
  }

  return node.keys().map((name) => {
    const child = node.get(name);
    return {
      name,
      path: path === "/" ? `/${name}` : `${path}/${name}`,
      type: getNodeType(child, groupCtor, datasetCtor),
    };
  });
}

function getNodeInfo(node, groupCtor, datasetCtor) {
  const type = getNodeType(node, groupCtor, datasetCtor);
  const shape = type === "dataset" ? getShape(node) : null;
  const dtype =
    type === "dataset"
      ? describeDtype(node?.dtype ?? node?.type ?? node?.datatype)
      : null;
  const info = {
    type,
    shape,
    dtype,
    attributes: extractAttributes(node),
  };

  return info;
}

function getTotalSize(shape) {
  if (!Array.isArray(shape) || !shape.length) {
    return 0;
  }

  return shape.reduce((total, dimension) => total * dimension, 1);
}

function normalizeDatasetValue(value) {
  if (!value && value !== 0) {
    return null;
  }

  if (typeof value?.toArray === "function") {
    return value.toArray();
  }

  if (value?.value !== undefined) {
    return normalizeDatasetValue(value.value);
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(value);
  }

  if (Array.isArray(value)) {
    return value;
  }

  return [value];
}

function isSliceDebugEnabled() {
  try {
    if (globalThis?.FDV_DEBUG_SLICES === false) {
      return false;
    }
    const search = globalThis?.location?.search;
    if (typeof search === "string") {
      const params = new URLSearchParams(search);
      if (params.has("debugSlices")) {
        return true;
      }
      if (params.get("debug") === "1") {
        return true;
      }
      if (params.has("debugSlicesOff")) {
        return false;
      }
    }
  } catch (error) {
    return false;
  }
  return true;
}

function isSliceDebugHandleEnabled() {
  try {
    const search = globalThis?.location?.search;
    if (typeof search !== "string") {
      return false;
    }
    const params = new URLSearchParams(search);
    return params.has("debugSlices") || params.get("debug") === "1";
  } catch (error) {
    return false;
  }
}

function formatSliceShape(shape) {
  if (!Array.isArray(shape) || shape.length === 0) {
    return "unknown";
  }
  if (shape.length === 1) {
    return `${shape[0]}x1`;
  }
  const [rows, cols] = shape.slice(-2);
  return `${rows}x${cols}`;
}

function resolveSliceIndex(start) {
  if (Array.isArray(start)) {
    return start[0] ?? 0;
  }
  if (start === undefined || start === null) {
    return 0;
  }
  return start;
}

function getDatasetIdentifier(dataset) {
  if (!dataset) {
    return "unknown";
  }
  return (
    dataset?.path ??
    dataset?.name ??
    dataset?.id ??
    dataset?.filename ??
    "unknown"
  );
}

function logSliceAttempt(dataset, start, stop, step, callForm) {
  if (!isSliceDebugEnabled()) {
    return;
  }
  const datasetId = getDatasetIdentifier(dataset);
  const shape = getShape(dataset);
  const dtype = describeDtype(dataset?.dtype ?? dataset?.type ?? dataset?.datatype);
  console.debug(`[FDV slice] Attempting ${callForm}`, {
    dataset: datasetId,
    shape,
    dtype,
    start,
    stop,
    step,
  });
}

function logSliceResult(callForm, sliceResult) {
  if (!isSliceDebugEnabled()) {
    return;
  }
  console.debug(`[FDV slice] Result from ${callForm}`, {
    type: typeof sliceResult,
    constructor: sliceResult?.constructor?.name,
    hasToArray: typeof sliceResult?.toArray === "function",
    hasValue: sliceResult ? "value" in sliceResult : false,
    hasShape: sliceResult ? "shape" in sliceResult : false,
    hasDims: sliceResult ? "dims" in sliceResult : false,
    hasLength: sliceResult ? "length" in sliceResult : false,
  });
}

function logMaterializedSlice(dataset, sliceValue) {
  if (!isSliceDebugEnabled()) {
    return;
  }
  const { shape } = describeSliceValue(sliceValue);
  const flat = to1DArray(sliceValue);
  const fullSize = getTotalSize(getShape(dataset) ?? []);
  console.debug("[FDV slice] Materialized slice stats", {
    type: typeof sliceValue,
    shape,
    flatLength: flat.length,
    sample: flat.slice(0, 5),
    fullSize,
    fullSizeMatches: flat.length === fullSize,
  });
}

function logSliceDetails(start, sliceValue) {
  if (!isSliceDebugEnabled()) {
    return;
  }
  const sliceIndex = resolveSliceIndex(start);
  const { shape, sample } = describeSliceValue(sliceValue);
  console.debug(`[FDV slice] Requested slice #: ${sliceIndex}`);
  console.debug(
    `[FDV slice] Slice ${sliceIndex} shape is ${formatSliceShape(shape)}`,
  );
  console.debug(`[FDV slice] Slice contents: ${sample.join(", ")}`);
}

function describeSliceValue(value) {
  const normalized = normalizeDatasetValue(value);
  if (!normalized) {
    return { shape: null, length: 0, sample: [] };
  }

  const shape = [];
  let cursor = normalized;
  while (Array.isArray(cursor)) {
    shape.push(cursor.length);
    cursor = cursor[0];
  }

  const flat = to1DArray(normalized);
  const sampleSize = Math.min(flat.length, 5);
  return {
    shape,
    length: flat.length,
    sample: flat.slice(0, sampleSize),
  };
}

function to1DArray(value) {
  const normalized = normalizeDatasetValue(value);
  if (!normalized) {
    return [];
  }

  if (Array.isArray(normalized) && Array.isArray(normalized[0])) {
    return normalized.flat();
  }

  return normalized;
}

function is2DArray(value) {
  return Array.isArray(value) && Array.isArray(value[0]);
}

function to2DArray(value, rowCount, colCount) {
  const normalized = normalizeDatasetValue(value);
  if (!normalized) {
    return [];
  }

  if (Array.isArray(normalized) && Array.isArray(normalized[0])) {
    return normalized.slice(0, rowCount).map((row) => row.slice(0, colCount));
  }

  const flat = Array.isArray(normalized) ? normalized : [];
  const rows = [];
  for (let row = 0; row < rowCount; row += 1) {
    rows.push(flat.slice(row * colCount, row * colCount + colCount));
  }
  return rows;
}

function readDatasetValue(dataset) {
  if (!dataset) {
    return null;
  }

  if (dataset.value !== undefined) {
    return dataset.value;
  }

  if (typeof dataset.toArray === "function") {
    return dataset.toArray();
  }

  return null;
}

function materializeSliceValue(slice) {
  if (slice && typeof slice.toArray === "function") {
    return slice.toArray();
  }
  return slice;
}

function resolvePositiveLimit(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function shouldAvoidMaterializing(totalElements, maxElements) {
  if (!Number.isFinite(maxElements)) {
    return false;
  }
  return maxElements > 0 && totalElements > maxElements;
}

function readDatasetSlice(dataset, start, stop, step) {
  if (!dataset || typeof dataset.slice !== "function") {
    return null;
  }

  const starts = Array.isArray(start) ? start : [start ?? 0];
  const stops = Array.isArray(stop) ? stop : [];
  const steps = Array.isArray(step) ? step : [];

  const dimCount = Math.max(starts.length, stops.length);

  const ranges = [];
  for (let i = 0; i < dimCount; i += 1) {
    const s = starts[i] ?? 0;
    const e = stops[i];
    const st = steps[i];

    if (e === undefined) {
      ranges.push([s]);
    } else if (st !== undefined) {
      ranges.push([s, e, st]);
    } else {
      ranges.push([s, e]);
    }
  }

  return dataset.slice(ranges);
}

function listDatasetsRecursive(node, path, groupCtor, datasetCtor, results) {
  const type = getNodeType(node, groupCtor, datasetCtor);

  if (type === "dataset") {
    results.push({
      name: path.split("/").pop() || path,
      path,
      parentPath: path.split("/").slice(0, -1).join("/") || "/",
      shape: getShape(node) ?? [],
      dtype: describeDtype(node?.dtype ?? node?.type ?? node?.datatype),
    });
    return;
  }

  if (type !== "group" || !node?.keys || typeof node.keys !== "function") {
    return;
  }

  for (const name of node.keys()) {
    const child = node.get(name);
    const childPath = path === "/" ? `/${name}` : `${path}/${name}`;
    listDatasetsRecursive(child, childPath, groupCtor, datasetCtor, results);
  }
}

async function createVirtualFile(
  FS,
  file,
  virtualName,
  accessMode,
  { allowFullFallback = false, fileUrl = null } = {},
) {
  if (accessMode !== "full") {
    if (!allowFullFallback) {
      throw new Error(
        "Lazy or metadata-only access requires Emscripten lazy file support.",
      );
    }
    console.warn(
      "Lazy HDF5 loading is not supported on the main thread. Falling back to full load.",
    );
  }

  if (Number.isFinite(file.size) && file.size > MAX_FILE_BYTES) {
    throw new FileTooLargeError(
      "File too large to load in-browser; use a smaller file or a desktop viewer.",
      { size: file.size, maxBytes: MAX_FILE_BYTES },
    );
  }

  let fileBuffer;
  try {
    fileBuffer = await file.arrayBuffer();
  } catch (error) {
    if (isArrayBufferAllocationError(error)) {
      throw new FileTooLargeError(
        "File too large to load in-browser; use a smaller file or a desktop viewer.",
        { size: file.size, maxBytes: MAX_FILE_BYTES },
      );
    }
    throw error;
  }
  try {
    const fileData = new Uint8Array(fileBuffer);
    if (typeof FS?.createDataFile === "function") {
      FS.createDataFile("/", virtualName, fileData, true, false, true);
    } else {
      FS.writeFile(virtualName, fileData);
    }
  } catch (error) {
    if (isArrayBufferAllocationError(error)) {
      throw new FileTooLargeError(
        "File too large to load in-browser; use a smaller file or a desktop viewer.",
        { size: file.size, maxBytes: MAX_FILE_BYTES },
      );
    }
    throw error;
  }

  return {
    loadStrategy: "full",
    cleanup: () => {},
  };
}

function coerceNumericArray(values) {
  const numeric = values.map((value) => Number(value));
  if (numeric.some((value) => Number.isNaN(value))) {
    return null;
  }
  return numeric;
}

function coerceNumericMatrix(rows) {
  if (!Array.isArray(rows)) {
    return null;
  }
  const numericRows = rows.map((row) => {
    if (!Array.isArray(row)) {
      return null;
    }
    return row.map((value) => Number(value));
  });
  if (numericRows.some((row) => !row || row.some((value) => Number.isNaN(value)))) {
    return null;
  }
  return numericRows;
}

function unwrapTo2D(value) {
  let normalized = normalizeDatasetValue(value);
  while (
    Array.isArray(normalized) &&
    Array.isArray(normalized[0]) &&
    Array.isArray(normalized[0][0])
  ) {
    normalized = normalized[0];
  }
  return normalized;
}

function applyLeadingIndices(value, leadingIndices) {
  let selected = normalizeDatasetValue(value);
  for (const index of leadingIndices) {
    if (!Array.isArray(selected)) {
      return selected;
    }
    const safeIndex = Math.min(index, Math.max(selected.length - 1, 0));
    selected = selected[safeIndex];
  }
  return selected;
}

function applyLeadingIndicesIfNeeded(value, leadingIndices) {
  const normalized = normalizeDatasetValue(value);
  if (
    !Array.isArray(normalized) ||
    !Array.isArray(normalized[0]) ||
    !Array.isArray(normalized[0][0])
  ) {
    return normalized;
  }
  return applyLeadingIndices(normalized, leadingIndices);
}

function slice1DValues(values, start, end, step = 1) {
  if (!Array.isArray(values) || !values.length) {
    return [];
  }
  const safeStart = Math.min(Math.max(start, 0), values.length);
  const safeEnd = Math.min(Math.max(end, safeStart), values.length);
  const safeStep = Math.max(1, step);
  const selected = [];
  for (let index = safeStart; index < safeEnd; index += safeStep) {
    selected.push(values[index]);
  }
  return selected;
}

function slice2DValues(values, rowStart, rowEnd, colStart, colEnd, rowStep = 1, colStep = 1) {
  if (!Array.isArray(values) || !values.length) {
    return [];
  }
  const rows = [];
  const safeRowStart = Math.min(Math.max(rowStart, 0), values.length);
  const safeRowEnd = Math.min(
    Math.max(rowEnd, safeRowStart),
    values.length,
  );
  const safeRowStep = Math.max(1, rowStep);
  for (let row = safeRowStart; row < safeRowEnd; row += safeRowStep) {
    const sourceRow = Array.isArray(values[row]) ? values[row] : [];
    const safeColStart = Math.min(Math.max(colStart, 0), sourceRow.length);
    const safeColEnd = Math.min(
      Math.max(colEnd, safeColStart),
      sourceRow.length,
    );
    const safeColStep = Math.max(1, colStep);
    const rowValues = [];
    for (let col = safeColStart; col < safeColEnd; col += safeColStep) {
      rowValues.push(sourceRow[col]);
    }
    rows.push(rowValues);
  }
  return rows;
}

function readDataset1DValues(dataset, shape, options = {}) {
  if (!Array.isArray(shape) || shape.length !== 1) {
    throw new Error("Selected dataset must be a 1D array.");
  }

  const length = shape[0] ?? 0;
  const start = Math.min(Math.max(options.start ?? 0, 0), length);
  const end = Math.min(Math.max(options.end ?? length, start), length);
  const rangeLength = Math.max(end - start, 0);
  const maxElements = resolvePositiveLimit(
    options.maxPoints ?? options.maxElements ?? DEFAULT_MAX_PREVIEW_POINTS,
    rangeLength,
  );
  let step = Math.max(1, options.step ?? 1);
  if (rangeLength > maxElements) {
    step = Math.max(step, Math.ceil(rangeLength / maxElements));
  }

  const slice = readDatasetSlice(
    dataset,
    [start],
    [end],
    step > 1 ? [step] : undefined,
  );
  if (slice) {
    return to1DArray(slice);
  }

  if (shouldAvoidMaterializing(length, maxElements)) {
    console.warn("Dataset too large to read without slicing.", {
      length,
      maxElements,
    });
    return [];
  }

  const value = readDatasetValue(dataset);
  const values = to1DArray(value);
  return slice1DValues(values, start, end, step);
}

function readDataset2DRowValues(dataset, shape, options = {}) {
  if (!Array.isArray(shape) || shape.length !== 2) {
    throw new Error("Selected dataset must be a 2D array.");
  }

  const [rows = 0, cols = 0] = shape;
  if (!rows || !cols) {
    return [];
  }

  const colStart = Math.min(Math.max(options.colStart ?? 0, 0), cols);
  const colEnd = Math.min(Math.max(options.colEnd ?? cols, colStart), cols);
  const colSpan = Math.max(colEnd - colStart, 0);
  const maxElements = resolvePositiveLimit(
    options.maxCols ?? options.maxElements ?? DEFAULT_MAX_PREVIEW_COLS,
    colSpan,
  );
  let step = Math.max(1, options.step ?? 1);
  if (colSpan > maxElements) {
    step = Math.max(step, Math.ceil(colSpan / maxElements));
  }
  const maxRowIndex = Math.max(rows - 1, 0);
  const rowIndex = Math.min(
    Math.max(options.rowIndex ?? 0, 0),
    maxRowIndex,
  );
  const start = [rowIndex, colStart];
  const end = [rowIndex + 1, colEnd];

  const rowSlice = readDatasetSlice(
    dataset,
    start,
    end,
    step > 1 ? [1, step] : undefined,
  );
  if (rowSlice) {
    const normalizedSlice = normalizeDatasetValue(rowSlice);
    if (is2DArray(normalizedSlice)) {
      const selectedRow = normalizedSlice[0];
      if (!Array.isArray(selectedRow)) {
        console.warn(
          "Unexpected row slice shape; unable to resolve row index.",
          normalizedSlice,
        );
        return [];
      }
      return to1DArray(selectedRow);
    }
    if (
      Array.isArray(normalizedSlice) &&
      normalizedSlice.length === rows * cols
    ) {
      const rowsData = to2DArray(normalizedSlice, rows, cols);
      return to1DArray(rowsData[rowIndex] ?? []);
    }
    return to1DArray(normalizedSlice);
  }

  if (shouldAvoidMaterializing(rows * cols, maxElements * Math.max(1, rows))) {
    console.warn("Dataset row too large to read without slicing.", {
      cols,
      rows,
      maxElements,
    });
    return [];
  }

  const value = readDatasetValue(dataset);
  const rowsData = to2DArray(value, rows, cols);
  const selectedRow = Array.isArray(rowsData[rowIndex])
    ? rowsData[rowIndex]
    : [];
  return slice1DValues(selectedRow, colStart, colEnd, step);
}

function readDataset2DColumnValues(dataset, shape, options = {}) {
  if (!Array.isArray(shape) || shape.length !== 2) {
    throw new Error("Selected dataset must be a 2D array.");
  }

  const [rows = 0, cols = 0] = shape;
  if (!rows || !cols) {
    return [];
  }

  const rowStart = Math.min(Math.max(options.rowStart ?? 0, 0), rows);
  const rowEnd = Math.min(Math.max(options.rowEnd ?? rows, rowStart), rows);
  const rowSpan = Math.max(rowEnd - rowStart, 0);
  const maxElements = resolvePositiveLimit(
    options.maxRows ?? options.maxElements ?? DEFAULT_MAX_PREVIEW_ROWS,
    rowSpan,
  );
  let step = Math.max(1, options.step ?? 1);
  if (rowSpan > maxElements) {
    step = Math.max(step, Math.ceil(rowSpan / maxElements));
  }
  const maxColIndex = Math.max(cols - 1, 0);
  const colIndex = Math.min(
    Math.max(options.colIndex ?? 0, 0),
    maxColIndex,
  );
  const start = [rowStart, colIndex];
  const end = [rowEnd, colIndex + 1];

  const colSlice = readDatasetSlice(
    dataset,
    start,
    end,
    step > 1 ? [step, 1] : undefined,
  );
  if (colSlice) {
    const normalizedSlice = normalizeDatasetValue(colSlice);
    if (is2DArray(normalizedSlice)) {
      const columnValues = normalizedSlice.map((row, rowIdx) => {
        if (!Array.isArray(row)) {
          console.warn(
            "Unexpected column slice shape; row is not an array.",
            row,
          );
          return undefined;
        }
        if (!row.length) {
          console.warn(
            "Unexpected column slice shape; column index out of bounds.",
            { colIndex: 0, rowIndex: rowIdx, rowLength: row.length },
          );
          return undefined;
        }
        return row[0];
      });
      return to1DArray(columnValues);
    }
    if (
      Array.isArray(normalizedSlice) &&
      normalizedSlice.length === rows * cols
    ) {
      const rowsData = to2DArray(normalizedSlice, rows, cols);
      const columnValues = rowsData.map((row, rowIdx) => {
        if (!Array.isArray(row)) {
          console.warn(
            "Unexpected column slice shape; row is not an array.",
            row,
          );
          return undefined;
        }
        if (!row.length) {
          console.warn(
            "Unexpected column slice shape; column index out of bounds.",
            { colIndex: 0, rowIndex: rowIdx, rowLength: row.length },
          );
          return undefined;
        }
        return row[0];
      });
      return to1DArray(columnValues);
    }
    return to1DArray(normalizedSlice);
  }

  if (shouldAvoidMaterializing(rows * cols, maxElements * Math.max(1, cols))) {
    console.warn("Dataset column too large to read without slicing.", {
      rows,
      cols,
      maxElements,
    });
    return [];
  }

  const value = readDatasetValue(dataset);
  const rowsData = to2DArray(value, rows, cols);
  const selectedRows = rowsData.map((row) =>
    Array.isArray(row) ? row[colIndex] : undefined,
  );
  return slice1DValues(selectedRows, rowStart, rowEnd, step);
}

function readDatasetND2DValues(dataset, shape, options = {}) {
  if (!Array.isArray(shape) || shape.length < 2) {
    throw new Error("Selected dataset must be at least 2D.");
  }

  const rowCount = shape[shape.length - 2] ?? 0;
  const colCount = shape[shape.length - 1] ?? 0;
  const rowStart = Math.min(Math.max(options.rowStart ?? 0, 0), rowCount);
  const rowEnd = Math.min(Math.max(options.rowEnd ?? rowCount, rowStart), rowCount);
  const colStart = Math.min(Math.max(options.colStart ?? 0, 0), colCount);
  const colEnd = Math.min(Math.max(options.colEnd ?? colCount, colStart), colCount);
  const rowSpan = Math.max(rowEnd - rowStart, 0);
  const colSpan = Math.max(colEnd - colStart, 0);
  const maxRows = resolvePositiveLimit(
    options.maxRows ?? DEFAULT_MAX_PREVIEW_ROWS,
    rowSpan,
  );
  const maxCols = resolvePositiveLimit(
    options.maxCols ?? DEFAULT_MAX_PREVIEW_COLS,
    colSpan,
  );
  let rowStep = Math.max(1, options.rowStep ?? options.step ?? 1);
  let colStep = Math.max(1, options.colStep ?? options.step ?? 1);
  if (rowSpan > maxRows) {
    rowStep = Math.max(rowStep, Math.ceil(rowSpan / maxRows));
  }
  if (colSpan > maxCols) {
    colStep = Math.max(colStep, Math.ceil(colSpan / maxCols));
  }
  const leadingDims = shape.slice(0, -2);
  const leadingIndices = leadingDims.map((size, index) => {
    const value = options.leadingIndices?.[index] ?? 0;
    return Math.min(Math.max(value, 0), Math.max(size - 1, 0));
  });

  if (!rowCount || !colCount) {
    return { values: [], leadingIndices };
  }

  const start = [...leadingIndices, rowStart, colStart];
  const end = [
    ...leadingIndices.map((value) => value + 1),
    rowEnd,
    colEnd,
  ];
  const sliceStep =
    rowStep > 1 || colStep > 1
      ? [...leadingIndices.map(() => 1), rowStep, colStep]
      : undefined;
  const slice = readDatasetSlice(dataset, start, end, sliceStep);
  if (slice) {
    const selectedSlice = applyLeadingIndicesIfNeeded(slice, leadingIndices);
    const normalizedSlice = unwrapTo2D(selectedSlice);
    return {
      values: to2DArray(
        normalizedSlice,
        Math.ceil(rowSpan / rowStep),
        Math.ceil(colSpan / colStep),
      ),
      leadingIndices,
    };
  }

  if (shape.length === 3) {
    return { values: [], leadingIndices };
  }

  if (shouldAvoidMaterializing(rowCount * colCount, maxRows * maxCols)) {
    console.warn("Dataset slice too large to read without slicing.", {
      rowCount,
      colCount,
      maxRows,
      maxCols,
    });
    return { values: [], leadingIndices };
  }

  const value = readDatasetValue(dataset);
  let selected = applyLeadingIndices(value, leadingIndices);
  if (!Array.isArray(selected)) {
    selected = [];
  }

  const sliced = slice2DValues(
    unwrapTo2D(selected),
    rowStart,
    rowEnd,
    colStart,
    colEnd,
    rowStep,
    colStep,
  );
  return {
    values: to2DArray(
      sliced,
      Math.ceil(rowSpan / rowStep),
      Math.ceil(colSpan / colStep),
    ),
    leadingIndices,
  };
}

function readDataset3DFrameValues(dataset, shape, options = {}) {
  if (!Array.isArray(shape) || shape.length !== 3) {
    throw new Error("Selected dataset must be a 3D array.");
  }

  const [timeCount = 0, rows = 0, cols = 0] = shape;
  if (!timeCount || !rows || !cols) {
    return [];
  }

  if (typeof dataset.slice !== "function") {
    throw new Error("Dataset slicing is unavailable.");
  }

  const maxIndex = Math.max(timeCount - 1, 0);
  const tIndex = Math.min(Math.max(options.tIndex ?? 0, 0), maxIndex);
  const rowStart = Math.min(Math.max(options.rowStart ?? 0, 0), rows);
  const rowEnd = Math.min(Math.max(options.rowEnd ?? rows, rowStart), rows);
  const colStart = Math.min(Math.max(options.colStart ?? 0, 0), cols);
  const colEnd = Math.min(Math.max(options.colEnd ?? cols, colStart), cols);
  const rowSpan = Math.max(rowEnd - rowStart, 0);
  const colSpan = Math.max(colEnd - colStart, 0);
  const maxRows = resolvePositiveLimit(
    options.maxRows ?? DEFAULT_MAX_PREVIEW_ROWS,
    rowSpan,
  );
  const maxCols = resolvePositiveLimit(
    options.maxCols ?? DEFAULT_MAX_PREVIEW_COLS,
    colSpan,
  );
  let rowStep = Math.max(1, options.rowStep ?? options.step ?? 1);
  let colStep = Math.max(1, options.colStep ?? options.step ?? 1);
  if (rowSpan > maxRows) {
    rowStep = Math.max(rowStep, Math.ceil(rowSpan / maxRows));
  }
  if (colSpan > maxCols) {
    colStep = Math.max(colStep, Math.ceil(colSpan / maxCols));
  }
  const slice = readDatasetSlice(
    dataset,
    [tIndex, rowStart, colStart],
    [tIndex + 1, rowEnd, colEnd],
    rowStep > 1 || colStep > 1 ? [1, rowStep, colStep] : undefined,
  );
  const materializedSlice = materializeSliceValue(slice);
  const normalizedSlice = normalizeDatasetValue(materializedSlice);
  const frame = unwrapTo2D(normalizedSlice);
  return to2DArray(
    frame,
    Math.ceil(rowSpan / rowStep),
    Math.ceil(colSpan / colStep),
  );
}

function buildUnavailablePreview(message, leadingIndices = []) {
  return {
    kind: "unavailable",
    message,
    leadingIndices,
  };
}

function getDatasetPreviewInternal(getNode, Group, Dataset, path = "/", options = {}) {
  const node = getNode(path);
  if (!node) {
    throw new Error("Selected dataset was not found.");
  }
  const type = getNodeType(node, Group, Dataset);
  if (type !== "dataset") {
    throw new Error("Preview is only available for datasets.");
  }

  const shape = getShape(node) ?? [];
  if (!shape.length) {
    return preview0D(node);
  }

  if (shape.length === 1) {
    return preview1D(node, shape, options);
  }

  if (shape.length === 2) {
    return preview2D(node, shape, options);
  }

  return previewND(node, shape, options);
}

function preview0D(dataset) {
  const value = readDatasetValue(dataset);
  const values = to1DArray(value);
  return {
    kind: "0d",
    value: values[0] ?? null,
    leadingIndices: [],
  };
}

function preview1D(dataset, shape, options) {
  const total = getTotalSize(shape);
  const limit = options.maxPoints ?? 1000;
  const truncated =
    total > limit ? `Showing first ${limit} of ${total} values.` : null;

  const cappedLength = Math.min(total, limit);
  const slice = readDatasetSlice(dataset, [0], [cappedLength]);
  if (slice) {
    return {
      kind: "1d",
      values: to1DArray(slice),
      truncated,
      leadingIndices: [],
    };
  }

  if (total > limit) {
    return buildUnavailablePreview(
      `Dataset has ${total} values. Preview slicing is unavailable.`,
    );
  }

  const value = readDatasetValue(dataset);
  return {
    kind: "1d",
    values: to1DArray(value),
    truncated,
    leadingIndices: [],
  };
}

function preview2D(dataset, shape, options) {
  const [rows = 0, cols = 0] = shape;
  const rowLimit = options.maxRows ?? 100;
  const colLimit = options.maxCols ?? 100;
  const shouldTruncate = rows > rowLimit && cols > colLimit;
  const maxRows = shouldTruncate ? Math.min(rows, rowLimit) : rows;
  const maxCols = shouldTruncate ? Math.min(cols, colLimit) : cols;
  const truncated = shouldTruncate
    ? `Showing ${maxRows} × ${maxCols} of ${rows} × ${cols}.`
    : null;

  const slice = readDatasetSlice(dataset, [0, 0], [maxRows, maxCols]);
  if (slice) {
    return {
      kind: "2d",
      rows: to2DArray(slice, maxRows, maxCols),
      truncated,
      leadingIndices: [],
    };
  }

  if (shouldTruncate) {
    return buildUnavailablePreview(
      `Dataset has ${rows} × ${cols} values. Preview slicing is unavailable.`,
    );
  }

  const value = readDatasetValue(dataset);
  return {
    kind: "2d",
    rows: to2DArray(value, maxRows, maxCols),
    truncated,
    leadingIndices: [],
  };
}

function previewND(dataset, shape, options) {
  const maxRows = options.maxRows ?? 100;
  const maxCols = options.maxCols ?? 100;
  const leadingDims = shape.slice(0, -2);
  const trailingShape = shape.slice(-2);
  const leadingIndices = leadingDims.map((size, index) => {
    const value = options.leadingIndices?.[index] ?? 0;
    return Math.min(Math.max(value, 0), Math.max(size - 1, 0));
  });
  const rows = trailingShape[0] ?? 0;
  const cols = trailingShape[1] ?? 0;
  const shouldTruncate = rows > maxRows && cols > maxCols;
  const rowCount = shouldTruncate ? Math.min(rows, maxRows) : rows;
  const colCount = shouldTruncate ? Math.min(cols, maxCols) : cols;
  const start = [...leadingIndices, 0, 0];
  const end = [
    ...leadingIndices.map((value) => value + 1),
    rowCount,
    colCount,
  ];
  const truncated = shouldTruncate
    ? `Showing ${rowCount} × ${colCount} of ${trailingShape[0]} × ${trailingShape[1]}.`
    : null;

  const slice = readDatasetSlice(dataset, start, end);
  if (!slice) {
    return buildUnavailablePreview(
      `Dataset has ${shape.length} dimensions. Slice preview is unavailable.`,
      leadingIndices,
    );
  }
  return {
    kind: "2d",
    rows: to2DArray(
      unwrapTo2D(applyLeadingIndicesIfNeeded(slice, leadingIndices)),
      rowCount,
      colCount,
    ),
    truncated,
    leadingIndices,
  };
}

export async function openFile(fileOrHandle, options = {}) {
  const file = await readFileInput(fileOrHandle);
  const accessMode = normalizeAccessMode(options.accessMode);
  const fileUrl = typeof options.fileUrl === "string" ? options.fileUrl : null;
  if (
    accessMode === "full" &&
    Number.isFinite(file.size) &&
    file.size > MAX_FILE_BYTES
  ) {
    throw new FileTooLargeError(
      "File too large to load in-browser; use a smaller file or a desktop viewer.",
      { size: file.size, maxBytes: MAX_FILE_BYTES },
    );
  }
  const hdf5Module = await loadHdf5Module();
  const readyModule = await resolveHdf5ReadyModule(hdf5Module);
  const hdf5Runtime = await resolveHdf5Runtime(hdf5Module, readyModule);
  const moduleForTypes = readyModule?.File ? readyModule : hdf5Module;
  const { File: H5File, Group, Dataset } = moduleForTypes;
  const { FS } = hdf5Runtime;

  const virtualName = `fdv-${crypto.randomUUID()}.h5`;
  if (
    accessMode === "lazy" &&
    Number.isFinite(file.size) &&
    file.size > MAX_FILE_BYTES
  ) {
    throw new FileTooLargeError(
      "File too large to load in-browser; use a smaller file or a desktop viewer.",
      { size: file.size, maxBytes: MAX_FILE_BYTES },
    );
  }
  const { loadStrategy, cleanup } = await createVirtualFile(
    FS,
    file,
    virtualName,
    accessMode,
    { allowFullFallback: true, fileUrl },
  );

  const h5File = new H5File(virtualName, "r");
  const metadataOnly = accessMode === "metadata";

  function assertDataAccess() {
    if (metadataOnly) {
      throw new Error(
        "This session is metadata-only. Re-open the file with accessMode: \"lazy\" or \"full\" to read data.",
      );
    }
  }

  function getNode(path = "/") {
    const normalizedPath = normalizePath(path);
    if (normalizedPath === "/") {
      return h5File;
    }
    try {
      return h5File.get(normalizedPath);
    } catch (error) {
      return null;
    }
  }

  if (isSliceDebugHandleEnabled()) {
    try {
      globalThis.__fdvGetNode = getNode;
      globalThis.__fdvH5File = h5File;
      globalThis.__fdvDescribeNode = (path) => {
        const node = getNode(path);
        const proto = node ? Object.getPrototypeOf(node) : null;
        return {
          path,
          type: typeof node,
          protoKeys: proto ? Object.getOwnPropertyNames(proto) : [],
          shape: node?.shape ?? node?.dims ?? node?.dimensions,
          dtype: node?.dtype ?? node?.type ?? node?.datatype,
          hasSlice: typeof node?.slice === "function",
          hasGet: typeof node?.get === "function",
          hasToArray: typeof node?.toArray === "function",
          hasValue: "value" in (node || {}),
        };
      };
      globalThis.__fdvTestSlice = (path, start, stop, step) => {
        const dataset = globalThis.__fdvGetNode?.(path);
        console.log("node:", globalThis.__fdvDescribeNode?.(path));
        return {
          result: readDatasetSlice(dataset, start, stop, step),
        };
      };
    } catch (error) {
      console.warn("Failed to initialize slice debug helpers.", error);
    }
  }

  return {
    name: file.name,
    listChildren(path = "/") {
      const normalizedPath = normalizePath(path);
      const node = getNode(normalizedPath);
      return listNodeChildren(node, normalizedPath, Group, Dataset);
    },
    getNodeInfo(path = "/") {
      const node = getNode(path);
      return getNodeInfo(node, Group, Dataset);
    },
    listDatasetsMetadata() {
      const results = [];
      listDatasetsRecursive(h5File, "/", Group, Dataset, results);
      return results;
    },
    listDatasets() {
      return this.listDatasetsMetadata();
    },
    readDataset1D(path = "/", options = {}) {
      assertDataAccess();
      const node = getNode(path);
      if (!node) {
        throw new Error("Selected dataset was not found.");
      }
      const type = getNodeType(node, Group, Dataset);
      if (type !== "dataset") {
        throw new Error("Selected path is not a dataset.");
      }

      const shape = getShape(node) ?? [];
      const dtype = describeDtype(node?.dtype ?? node?.type ?? node?.datatype);
      const rawValues = readDataset1DValues(node, shape, options);
      const numericValues = coerceNumericArray(rawValues);
      if (!numericValues) {
        throw new Error("Dataset contains non-numeric values.");
      }

      return {
        values: numericValues,
        length: shape[0] ?? numericValues.length,
        shape,
        dtype,
      };
    },
    readDataset2DRow(path = "/", options = {}) {
      assertDataAccess();
      const node = getNode(path);
      if (!node) {
        throw new Error("Selected dataset was not found.");
      }
      const type = getNodeType(node, Group, Dataset);
      if (type !== "dataset") {
        throw new Error("Selected path is not a dataset.");
      }

      const shape = getShape(node) ?? [];
      if (shape.length !== 2) {
        throw new Error("Selected dataset must be a 2D array.");
      }

      const dtype = describeDtype(node?.dtype ?? node?.type ?? node?.datatype);
      const rawValues = readDataset2DRowValues(node, shape, options);
      const numericValues = coerceNumericArray(rawValues);
      if (!numericValues) {
        throw new Error("Dataset contains non-numeric values.");
      }

      return {
        values: numericValues,
        length: shape[1] ?? numericValues.length,
        shape,
        dtype,
        rowIndex: Math.max(0, options.rowIndex ?? 0),
      };
    },
    readDataset2DColumn(path = "/", options = {}) {
      assertDataAccess();
      const node = getNode(path);
      if (!node) {
        throw new Error("Selected dataset was not found.");
      }
      const type = getNodeType(node, Group, Dataset);
      if (type !== "dataset") {
        throw new Error("Selected path is not a dataset.");
      }

      const shape = getShape(node) ?? [];
      if (shape.length !== 2) {
        throw new Error("Selected dataset must be a 2D array.");
      }

      const dtype = describeDtype(node?.dtype ?? node?.type ?? node?.datatype);
      const rawValues = readDataset2DColumnValues(node, shape, options);
      const numericValues = coerceNumericArray(rawValues);
      if (!numericValues) {
        throw new Error("Dataset contains non-numeric values.");
      }

      return {
        values: numericValues,
        length: shape[0] ?? numericValues.length,
        shape,
        dtype,
        colIndex: Math.max(0, options.colIndex ?? 0),
      };
    },
    readDatasetND2D(path = "/", options = {}) {
      assertDataAccess();
      const node = getNode(path);
      if (!node) {
        throw new Error("Selected dataset was not found.");
      }
      const type = getNodeType(node, Group, Dataset);
      if (type !== "dataset") {
        throw new Error("Selected path is not a dataset.");
      }

      const shape = getShape(node) ?? [];
      if (shape.length < 2) {
        throw new Error("Selected dataset must be at least 2D.");
      }

      const dtype = describeDtype(node?.dtype ?? node?.type ?? node?.datatype);
      const rawValues = readDatasetND2DValues(node, shape, options);
      const numericValues = coerceNumericMatrix(rawValues.values);
      if (!numericValues) {
        throw new Error("Dataset contains non-numeric values.");
      }

      return {
        values: numericValues,
        shape,
        dtype,
        leadingIndices: rawValues.leadingIndices,
      };
    },
    readDataset3DFrame(path = "/", options = {}) {
      assertDataAccess();
      const node = getNode(path);
      const type = getNodeType(node, Group, Dataset);
      if (type !== "dataset") {
        throw new Error("Selected path is not a dataset.");
      }

      const shape = getShape(node) ?? [];
      if (shape.length !== 3) {
        throw new Error("Selected dataset must be a 3D array.");
      }

      const dtype = describeDtype(node?.dtype ?? node?.type ?? node?.datatype);
      const rawValues = readDataset3DFrameValues(node, shape, options);
      const numericValues = coerceNumericMatrix(rawValues);
      if (!numericValues) {
        throw new Error("Dataset contains non-numeric values.");
      }

      return {
        values: numericValues,
        shape,
        dtype,
        tIndex: Math.max(0, options.tIndex ?? 0),
      };
    },
    getDatasetPreview(path = "/", options = {}) {
      assertDataAccess();
      return getDatasetPreviewInternal(getNode, Group, Dataset, path, options);
    },
    async getDatasetPreviewAsync(path = "/", options = {}) {
      assertDataAccess();
      await deferToEventLoop();
      return getDatasetPreviewInternal(getNode, Group, Dataset, path, options);
    },
    accessMode,
    loadStrategy,
    metadataOnly,
    close() {
      if (typeof h5File?.close === "function") {
        h5File.close();
      }
      try {
        FS.unlink(virtualName);
      } catch (error) {
        console.warn("Failed to remove virtual file from HDF5 FS.", error);
      }
      cleanup();
    },
  };
}
