export const LATENCY_BOUNDARIES_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

export type HistogramSnapshot = {
  boundaries: number[];
  counts: number[];
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
};

export const createHistogram = (): HistogramSnapshot => ({
  boundaries: [...LATENCY_BOUNDARIES_MS],
  counts: new Array(LATENCY_BOUNDARIES_MS.length + 1).fill(0),
  count: 0,
  sum: 0,
  min: null,
  max: null,
});

export const observeHistogram = (histogram: HistogramSnapshot, rawValue: number) => {
  const value = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
  const index = histogram.boundaries.findIndex((boundary) => value <= boundary);
  histogram.counts[index === -1 ? histogram.counts.length - 1 : index] += 1;
  histogram.count += 1;
  histogram.sum += value;
  histogram.min = histogram.min === null ? value : Math.min(histogram.min, value);
  histogram.max = histogram.max === null ? value : Math.max(histogram.max, value);
};

export const mergeHistograms = (items: HistogramSnapshot[]) => {
  const result = createHistogram();
  for (const item of items) {
    item.counts.forEach((count, index) => { result.counts[index] += count; });
    result.count += item.count;
    result.sum += item.sum;
    if (item.min !== null) result.min = result.min === null ? item.min : Math.min(result.min, item.min);
    if (item.max !== null) result.max = result.max === null ? item.max : Math.max(result.max, item.max);
  }
  return result;
};

export const histogramQuantile = (histogram: HistogramSnapshot, percentile: number) => {
  if (histogram.count === 0) return null;
  const target = Math.max(1, Math.ceil(histogram.count * percentile));
  let cumulative = 0;
  for (let index = 0; index < histogram.counts.length; index += 1) {
    cumulative += histogram.counts[index];
    if (cumulative >= target) {
      return index < histogram.boundaries.length
        ? histogram.boundaries[index]
        : histogram.max;
    }
  }
  return histogram.max;
};

export const histogramSummary = (histogram: HistogramSnapshot) => ({
  count: histogram.count,
  averageMs: histogram.count ? histogram.sum / histogram.count : null,
  p50Ms: histogramQuantile(histogram, 0.5),
  p95Ms: histogramQuantile(histogram, 0.95),
  p99Ms: histogramQuantile(histogram, 0.99),
  minMs: histogram.min,
  maxMs: histogram.max,
});
