const PLOTLY_CDN_PRIMARY = "https://cdn.plot.ly/plotly-3.3.1.min.js";
const PLOTLY_CDN_FALLBACK =
  "https://cdnjs.cloudflare.com/ajax/libs/plotly.js/3.3.1/plotly.min.js";

let plotlyPromise;

const DEFAULT_PLOT_SETTINGS = Object.freeze({
  title: "",
  xAxisLabel: "",
  yAxisLabel: "",
  sliderLabel: "",
  colorbarLabel: "",
  aspectRatio: "16:10",
  scaleMode: "auto",
  xScale: "linear",
  yScale: "linear",
  xRangeMode: "auto",
  xRangeMin: "",
  xRangeMax: "",
  yRangeMode: "auto",
  yRangeMin: "",
  yRangeMax: "",
  showGrid: true,
  tickDensity: "auto",
  lineColor: "#2d3870",
  lineWidth: 2,
  lineStyle: "solid",
  showMarkers: false,
  markerSize: 6,
  markerShape: "circle",
  traceName: "",
  showLegend: false,
  hoverEnabled: true,
  maxPoints: 100000,
  maxRows: 1000,
  maxCols: 1000,
  decimationStep: 1,
});

const ASPECT_RATIO_PRESETS = new Map([
  ["1:1", [1, 1]],
  ["4:3", [4, 3]],
  ["3:2", [3, 2]],
  ["10:2", [10, 2]],
  ["16:10", [16, 10]],
  ["16:9", [16, 9]],
]);
const aspectRatioState = new WeakMap();

function resolvePlotWrapper(container) {
  if (!container) {
    return null;
  }
  if (container.closest) {
    const wrapper = container.closest(".plot-area");
    if (wrapper) {
      return wrapper;
    }
  }
  return container.parentElement ?? container;
}

function resolvePlotlyGlobal() {
  return globalThis.Plotly ?? null;
}

function loadPlotlyScript(url) {
  return new Promise((resolve, reject) => {
    const existing = resolvePlotlyGlobal();
    if (existing) {
      resolve(existing);
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = url;
    script.onload = () => {
      const plotly = resolvePlotlyGlobal();
      if (plotly) {
        resolve(plotly);
        return;
      }
      reject(new Error("Plotly loaded but global export not found."));
    };
    script.onerror = () => {
      reject(new Error(`Failed to load Plotly from ${url}.`));
    };
    document.head.appendChild(script);
  });
}

export async function loadPlotly() {
  if (!plotlyPromise) {
    plotlyPromise = loadPlotlyScript(PLOTLY_CDN_PRIMARY).catch((error) => {
      console.warn("Primary Plotly load failed, using fallback.", error);
      return loadPlotlyScript(PLOTLY_CDN_FALLBACK);
    });
  }

  return plotlyPromise;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapTickDensity(density) {
  if (density === "sparse") {
    return 5;
  }
  if (density === "dense") {
    return 12;
  }
  return null;
}

function mergeObjects(target, source) {
  if (!source || typeof source !== "object") {
    return target;
  }
  Object.entries(source).forEach(([key, value]) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof target[key] === "object" &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      target[key] = mergeObjects({ ...target[key] }, value);
    } else {
      target[key] = value;
    }
  });
  return target;
}

function resolveAspectRatioPreset(value) {
  if (!value || value === "auto") {
    return null;
  }
  return ASPECT_RATIO_PRESETS.get(value) ?? null;
}

function clearAspectRatioObserver(container) {
  const entry = aspectRatioState.get(container);
  if (entry?.observer) {
    entry.observer.disconnect();
  }
  aspectRatioState.delete(container);
}

function ensureAspectRatioObserver(container, plotly, wrapper) {
  let entry = aspectRatioState.get(container);
  if (!entry) {
    entry = {};
    aspectRatioState.set(container, entry);
  }

  if (entry.observer && entry.wrapper && entry.wrapper !== wrapper) {
    entry.observer.disconnect();
    entry.observer = null;
  }

  if (!entry.observer) {
    entry.observer = new ResizeObserver(() => {
      if (entry.frame) {
        cancelAnimationFrame(entry.frame);
      }
      entry.frame = requestAnimationFrame(() => {
        if (entry.ratio) {
          applyAspectRatioLayout(plotly, container, entry.ratio);
        }
      });
    });
    if (wrapper) {
      entry.observer.observe(wrapper);
    } else {
      entry.observer.observe(container);
    }
    entry.wrapper = wrapper ?? container;
  }

  return entry;
}

async function resizePlotly(plotly, container) {
  if (plotly?.Plots?.resize) {
    await plotly.Plots.resize(container);
  }
}

export async function resizePlot(container) {
  const plotly = resolvePlotlyGlobal();
  if (!plotly?.Plots?.resize || !container) {
    return;
  }
  if (!container.data && !container._fullLayout) {
    return;
  }
  await plotly.Plots.resize(container);
}

async function applyAspectRatioLayout(plotly, container, aspectRatio) {
  const ratio = resolveAspectRatioPreset(aspectRatio);
  const wrapper = resolvePlotWrapper(container);
  if (!ratio) {
    clearAspectRatioObserver(container);
    if (wrapper?.style) {
      wrapper.style.height = "";
      wrapper.style.width = "";
      wrapper.style.aspectRatio = "";
    }
    wrapper?.classList?.remove("has-aspect-ratio");
    await plotly.relayout(container, {
      autosize: true,
      width: null,
      height: null,
    });
    await resizePlotly(plotly, container);
    return;
  }

  const [ratioWidth, ratioHeight] = ratio;
  const initialWidth = Math.round(wrapper?.clientWidth ?? 0);
  if (!initialWidth) {
    return;
  }
  const desiredHeight = Math.round(
    initialWidth * (ratioHeight / ratioWidth)
  );
  let constrainedHeight = desiredHeight;
  const parent = wrapper?.parentElement ?? null;
  const shouldConstrainHeight =
    parent && !wrapper?.classList?.contains("dashboard-plot-area");
  if (shouldConstrainHeight) {
    const parentRect = parent.getBoundingClientRect();
    const parentHeight = Math.max(0, Math.round(parentRect.height));
    const siblings = Array.from(parent.children).filter(
      (child) => child !== wrapper
    );
    const siblingsHeight = siblings.reduce(
      (total, child) => total + Math.round(child.getBoundingClientRect().height),
      0
    );
    const gapValue = Number.parseFloat(getComputedStyle(parent).rowGap);
    const gapCount = Math.max(0, parent.children.length - 1);
    const totalGap = Number.isFinite(gapValue) ? gapValue * gapCount : 0;
    const availableHeight = Math.max(
      0,
      Math.round(parentHeight - siblingsHeight - totalGap)
    );
    if (availableHeight && desiredHeight > availableHeight) {
      constrainedHeight = availableHeight;
    }
  }
  if (wrapper?.style) {
    wrapper.style.height = `${constrainedHeight}px`;
    wrapper.style.width = "";
    wrapper.style.aspectRatio = `${ratioWidth} / ${ratioHeight}`;
  }
  wrapper?.classList?.add("has-aspect-ratio");
  const computedStyle = wrapper ? getComputedStyle(wrapper) : null;
  const paddingLeft = computedStyle
    ? Number.parseFloat(computedStyle.paddingLeft)
    : 0;
  const paddingRight = computedStyle
    ? Number.parseFloat(computedStyle.paddingRight)
    : 0;
  const paddingTop = computedStyle
    ? Number.parseFloat(computedStyle.paddingTop)
    : 0;
  const paddingBottom = computedStyle
    ? Number.parseFloat(computedStyle.paddingBottom)
    : 0;
  const horizontalPadding =
    (Number.isFinite(paddingLeft) ? paddingLeft : 0) +
    (Number.isFinite(paddingRight) ? paddingRight : 0);
  const verticalPadding =
    (Number.isFinite(paddingTop) ? paddingTop : 0) +
    (Number.isFinite(paddingBottom) ? paddingBottom : 0);
  const height = Math.max(
    1,
    Math.round(
      (wrapper?.clientHeight ?? constrainedHeight) - verticalPadding
    )
  );
  const adjustedWidth = Math.max(
    1,
    Math.round((wrapper?.clientWidth ?? initialWidth) - horizontalPadding)
  );

  const entry = ensureAspectRatioObserver(container, plotly, wrapper);
  if (
    entry.lastWidth === adjustedWidth &&
    entry.lastHeight === height &&
    entry.ratio === aspectRatio
  ) {
    return;
  }

  entry.lastWidth = adjustedWidth;
  entry.lastHeight = height;
  entry.ratio = aspectRatio;

  await plotly.relayout(container, {
    autosize: false,
    width: adjustedWidth,
    height,
  });
}

export function createDefaultPlotSettings() {
  return structuredClone(DEFAULT_PLOT_SETTINGS);
}

export function buildPlotSpec({ x, y, labels, plotSettings }) {
  const settings = { ...DEFAULT_PLOT_SETTINGS, ...(plotSettings ?? {}) };
  const xLabel = settings.xAxisLabel || labels?.xLabel || "X";
  const yLabel = settings.yAxisLabel || labels?.yLabel || "Y";
  const tickCount = mapTickDensity(settings.tickDensity);

  const traceMode = settings.showMarkers ? "lines+markers" : "lines";
  const trace = {
    type: "scatter",
    mode: traceMode,
    x,
    y,
    name: settings.traceName || undefined,
    hoverinfo: settings.hoverEnabled ? "x+y+name" : "skip",
    line: {
      color: settings.lineColor,
      width: settings.lineWidth,
      dash:
        settings.lineStyle === "solid"
          ? undefined
          : settings.lineStyle === "dashed"
            ? "dash"
            : "dot",
    },
    marker: settings.showMarkers
      ? {
          size: settings.markerSize,
          symbol: settings.markerShape,
          color: settings.lineColor,
        }
      : undefined,
    selected: {
      marker: { color: "#47c6ef" },
      line: { color: "#47c6ef" },
    },
    unselected: {
      marker: { opacity: 0.6 },
      line: { opacity: 0.6 },
    },
  };

  const xRangeMin = toNumberOrNull(settings.xRangeMin);
  const xRangeMax = toNumberOrNull(settings.xRangeMax);
  const yRangeMin = toNumberOrNull(settings.yRangeMin);
  const yRangeMax = toNumberOrNull(settings.yRangeMax);

  const layout = {
    title: settings.title ? { text: settings.title } : undefined,
    margin: { t: settings.title ? 40 : 20, r: 16, b: 40, l: 50 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    showlegend: settings.showLegend,
    hovermode: settings.hoverEnabled ? "closest" : false,
    font: { color: "#141414" },
    hoverlabel: {
      bgcolor: "#47c6ef",
      bordercolor: "#2d3870",
      font: { color: "#141414" },
    },
    xaxis: {
      title: { text: xLabel, font: { size: 11 } },
      type: settings.xScale,
      zerolinecolor: "#dbe2e9",
      gridcolor: "#dbe2e9",
      color: "#141414",
      showgrid: settings.showGrid,
      nticks: tickCount ?? undefined,
      range:
        settings.xRangeMode === "manual" &&
        xRangeMin !== null &&
        xRangeMax !== null
          ? [xRangeMin, xRangeMax]
          : undefined,
    },
    yaxis: {
      title: { text: yLabel, font: { size: 11 } },
      type: settings.yScale,
      zerolinecolor: "#dbe2e9",
      gridcolor: "#dbe2e9",
      color: "#141414",
      showgrid: settings.showGrid,
      nticks: tickCount ?? undefined,
      range:
        settings.yRangeMode === "manual" &&
        yRangeMin !== null &&
        yRangeMax !== null
          ? [yRangeMin, yRangeMax]
          : undefined,
    },
  };

  const config = {
    responsive: true,
    displaylogo: false,
  };

  return { data: [trace], layout, config };
}

export function buildHeatmapSpec({ x, y, z, labels, plotSettings }) {
  const settings = { ...DEFAULT_PLOT_SETTINGS, ...(plotSettings ?? {}) };
  const xLabel = settings.xAxisLabel || labels?.xLabel || "X";
  const yLabel = settings.yAxisLabel || labels?.yLabel || "Y";
  const zLabel =
    settings.colorbarLabel || labels?.zLabel || settings.traceName || "Value";
  const tickCount = mapTickDensity(settings.tickDensity);

  const trace = {
    type: "contour",
    x,
    y,
    z,
    contours: {
      coloring: "lines",
    },
    colorscale: "Viridis",
    showscale: true,
    hoverinfo: settings.hoverEnabled ? "x+y+z" : "skip",
    colorbar: {
      title: { text: zLabel, side: "right", textangle: 90, font: { size: 11 } },
    },
  };

  const xRangeMin = toNumberOrNull(settings.xRangeMin);
  const xRangeMax = toNumberOrNull(settings.xRangeMax);
  const yRangeMin = toNumberOrNull(settings.yRangeMin);
  const yRangeMax = toNumberOrNull(settings.yRangeMax);

  const layout = {
    title: settings.title ? { text: settings.title } : undefined,
    margin: { t: settings.title ? 40 : 20, r: 60, b: 40, l: 60 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    showlegend: false,
    hovermode: settings.hoverEnabled ? "closest" : false,
    font: { color: "#141414" },
    hoverlabel: {
      bgcolor: "#47c6ef",
      bordercolor: "#2d3870",
      font: { color: "#141414" },
    },
    xaxis: {
      title: { text: xLabel, font: { size: 11 } },
      type: settings.xScale === "log" ? "log" : "linear",
      showgrid: settings.showGrid,
      nticks: tickCount ?? undefined,
      range:
        settings.xRangeMode === "manual" &&
        xRangeMin !== null &&
        xRangeMax !== null
          ? [xRangeMin, xRangeMax]
          : undefined,
    },
    yaxis: {
      title: { text: yLabel, font: { size: 11 } },
      type: settings.yScale === "log" ? "log" : "linear",
      showgrid: settings.showGrid,
      nticks: tickCount ?? undefined,
      range:
        settings.yRangeMode === "manual" &&
        yRangeMin !== null &&
        yRangeMax !== null
          ? [yRangeMin, yRangeMax]
          : undefined,
      ...(settings.equalScale
        ? { scaleanchor: "x", scaleratio: 1 }
        : {}),
    },
  };

  const config = {
    responsive: true,
    displaylogo: false,
  };

  return { data: [trace], layout, config };
}

export function applyPlotOverrides(baseSpec, overrides) {
  if (!overrides || typeof overrides !== "object") {
    return baseSpec;
  }
  const merged = {
    data: baseSpec.data.map((trace) => ({ ...trace })),
    layout: { ...baseSpec.layout },
    config: { ...baseSpec.config },
  };

  if (overrides.data) {
    const dataOverride = Array.isArray(overrides.data)
      ? overrides.data[0]
      : overrides.data;
    if (dataOverride && typeof dataOverride === "object") {
      merged.data[0] = mergeObjects({ ...merged.data[0] }, dataOverride);
    }
  }

  if (overrides.layout && typeof overrides.layout === "object") {
    merged.layout = mergeObjects({ ...merged.layout }, overrides.layout);
  }

  if (overrides.config && typeof overrides.config === "object") {
    merged.config = mergeObjects({ ...merged.config }, overrides.config);
  }

  return merged;
}

export async function renderXYPlot(container, x, y, options = {}) {
  if (!container) {
    throw new Error("Plot container not found.");
  }

  const plotly = await loadPlotly();
  const aspectRatio = options.plotSettings?.aspectRatio;
  const lockedAspectRatio = Boolean(resolveAspectRatioPreset(aspectRatio));
  const baseSpec = buildPlotSpec({
    x,
    y,
    labels: {
      xLabel: options.xLabel,
      yLabel: options.yLabel,
    },
    plotSettings: options.plotSettings,
  });
  const finalSpec = applyPlotOverrides(baseSpec, options.plotOverrides);
  if (finalSpec.config && lockedAspectRatio) {
    finalSpec.config = { ...finalSpec.config, responsive: false };
  }
  const safeData = Array.isArray(finalSpec.data)
    ? finalSpec.data.filter(
        (trace) => trace && typeof trace === "object",
      )
    : [];
  if (!safeData.length) {
    throw new Error("Plot data is unavailable.");
  }

  const normalizedData = safeData.map((trace) => {
    const nextTrace = { ...trace };
    if (!nextTrace.line || typeof nextTrace.line !== "object") {
      nextTrace.line = {};
    }
    if (!nextTrace.marker || typeof nextTrace.marker !== "object") {
      nextTrace.marker = {};
    }
    return nextTrace;
  });

  await plotly.newPlot(
    container,
    normalizedData,
    finalSpec.layout,
    finalSpec.config,
  );

  await applyAspectRatioLayout(
    plotly,
    container,
    aspectRatio,
  );
}

export async function renderXYPlotSeries(container, series, options = {}) {
  if (!container) {
    throw new Error("Plot container not found.");
  }
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error("Plot data is unavailable.");
  }

  const plotly = await loadPlotly();
  const aspectRatio = options.plotSettings?.aspectRatio;
  const lockedAspectRatio = Boolean(resolveAspectRatioPreset(aspectRatio));
  const firstSeries = series[0];
  const baseSpec = buildPlotSpec({
    x: firstSeries.x,
    y: firstSeries.y,
    labels: {
      xLabel: options.xLabel,
      yLabel: options.yLabel,
    },
    plotSettings: options.plotSettings,
  });
  const baseTrace = Array.isArray(baseSpec.data) ? baseSpec.data[0] : null;
  if (!baseTrace) {
    throw new Error("Plot data is unavailable.");
  }

  const traces = series.map((entry, index) => {
    const nextTrace = {
      ...baseTrace,
      x: entry.x ?? firstSeries.x,
      y: entry.y,
    };
    if (entry.name) {
      nextTrace.name = entry.name;
    }
    if (index > 0) {
      if (nextTrace.line && typeof nextTrace.line === "object") {
        nextTrace.line = { ...nextTrace.line };
        delete nextTrace.line.color;
      }
      if (nextTrace.marker && typeof nextTrace.marker === "object") {
        nextTrace.marker = { ...nextTrace.marker };
        delete nextTrace.marker.color;
      }
    }
    return nextTrace;
  });

  const legendEnabled =
    series.length > 1 || Boolean(options.plotSettings?.showLegend);
  const finalSpec = applyPlotOverrides(
    {
      ...baseSpec,
      data: traces,
      layout: {
        ...baseSpec.layout,
        showlegend: legendEnabled,
      },
    },
    options.plotOverrides,
  );
  if (finalSpec.config && lockedAspectRatio) {
    finalSpec.config = { ...finalSpec.config, responsive: false };
  }

  const safeData = Array.isArray(finalSpec.data)
    ? finalSpec.data.filter(
        (trace) => trace && typeof trace === "object",
      )
    : [];
  if (!safeData.length) {
    throw new Error("Plot data is unavailable.");
  }

  const normalizedData = safeData.map((trace) => {
    const nextTrace = { ...trace };
    if (!nextTrace.line || typeof nextTrace.line !== "object") {
      nextTrace.line = {};
    }
    if (!nextTrace.marker || typeof nextTrace.marker !== "object") {
      nextTrace.marker = {};
    }
    return nextTrace;
  });

  await plotly.newPlot(
    container,
    normalizedData,
    finalSpec.layout,
    finalSpec.config,
  );

  await applyAspectRatioLayout(
    plotly,
    container,
    aspectRatio,
  );
}

export async function renderHeatmapPlot(container, x, y, z, options = {}) {
  if (!container) {
    throw new Error("Plot container not found.");
  }

  const plotly = await loadPlotly();
  const aspectRatio = options.plotSettings?.aspectRatio;
  const lockedAspectRatio = Boolean(resolveAspectRatioPreset(aspectRatio));
  const baseSpec = buildHeatmapSpec({
    x,
    y,
    z,
    labels: {
      xLabel: options.xLabel,
      yLabel: options.yLabel,
      zLabel: options.zLabel,
    },
    plotSettings: options.plotSettings,
  });
  const finalSpec = applyPlotOverrides(baseSpec, options.plotOverrides);
  if (finalSpec.config && lockedAspectRatio) {
    finalSpec.config = { ...finalSpec.config, responsive: false };
  }

  const safeData = Array.isArray(finalSpec.data)
    ? finalSpec.data.filter(
        (trace) => trace && typeof trace === "object",
      )
    : [];
  if (!safeData.length) {
    throw new Error("Plot data is unavailable.");
  }

  await plotly.newPlot(
    container,
    safeData,
    finalSpec.layout,
    finalSpec.config,
  );

  await applyAspectRatioLayout(
    plotly,
    container,
    aspectRatio,
  );
}

export async function disposePlot(container) {
  const plotly = resolvePlotlyGlobal();
  if (!plotly || !container) {
    return;
  }

  clearAspectRatioObserver(container);
  plotly.purge(container);
}
