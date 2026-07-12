import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistogram, histogramQuantile, mergeHistograms, observeHistogram } from './histogram';

test('computes percentiles from merged bucket counts', () => {
  const first = createHistogram();
  const second = createHistogram();
  [5, 10, 20, 40, 80].forEach((value) => observeHistogram(first, value));
  [100, 200, 400, 800, 1600].forEach((value) => observeHistogram(second, value));
  const merged = mergeHistograms([first, second]);
  assert.equal(merged.count, 10);
  assert.equal(histogramQuantile(merged, 0.5), 100);
  assert.equal(histogramQuantile(merged, 0.95), 2500);
});

test('returns null for percentiles without observations', () => {
  assert.equal(histogramQuantile(createHistogram(), 0.95), null);
});

test('preserves min, max and sum when histograms merge', () => {
  const one = createHistogram();
  const two = createHistogram();
  observeHistogram(one, 7);
  observeHistogram(two, 99);
  const merged = mergeHistograms([one, two]);
  assert.equal(merged.min, 7);
  assert.equal(merged.max, 99);
  assert.equal(merged.sum, 106);
});
