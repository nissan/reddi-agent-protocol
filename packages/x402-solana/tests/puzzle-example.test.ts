const { analyze, checkAnalysis, syntheticRequest } = require('../examples/puzzle-service.cjs');
test('synthetic service gives independently checked exact count without a payment receipt', () => {
  const result = analyze(syntheticRequest);
  expect(result.count).toBe(1);
  expect(result.solutions).toEqual([[0, 4, 8]]);
  expect(() => checkAnalysis(syntheticRequest, result)).not.toThrow();
  expect(result).not.toHaveProperty('receipt');
});
test('independent checker rejects a false count, omitted solution, or another puzzle', () => {
  const result = analyze(syntheticRequest);
  expect(() => checkAnalysis(syntheticRequest, { ...result, count: 0 })).toThrow();
  expect(() => checkAnalysis(syntheticRequest, { ...result, solutions: [] })).toThrow();
  expect(() => checkAnalysis({ ...syntheticRequest, empty: [] }, result)).toThrow();
  expect(() => analyze({ ...syntheticRequest, size: 100 })).toThrow();
});
