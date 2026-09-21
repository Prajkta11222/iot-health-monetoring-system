import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOverallRisk } from '../src/services/overallRiskEngine.js';
import { validateReading } from '../src/validators/reading.js';

const reading = (overrides = {}) => ({
  deviceId: 'D1', timestamp: new Date().toISOString(), heartRate: 72, heartRateValid: true,
  spo2: 98, spo2Valid: true, temperature: 36.7, temperatureValid: true,
  ecgSignalQuality: 'GOOD', ecgLeadOff: false, ppgSignalQuality: 'GOOD', fingerDetected: true, ...overrides
});
const ml = (riskLabel = 'LOW') => ({ riskLabel, signalQuality: 'GOOD' });

test('valid readings and LOW ECG classification produce LOW_RISK', () => {
  assert.equal(evaluateOverallRisk({ reading: reading(), mlResult: ml(), recentReadings: [reading(), reading()] }).overallRisk, 'LOW_RISK');
});
test('HIGH ECG classification produces HIGH_RISK', () => {
  assert.equal(evaluateOverallRisk({ reading: reading(), mlResult: ml('HIGH') }).overallRisk, 'HIGH_RISK');
});
test('missing HR, SpO2, or temperature produces INSUFFICIENT_DATA', () => {
  for (const field of ['heartRate', 'spo2', 'temperature']) {
    const validField = `${field}Valid`;
    assert.equal(evaluateOverallRisk({ reading: reading({ [field]: null, [validField]: false }), mlResult: ml() }).overallRisk, 'INSUFFICIENT_DATA');
  }
});
test('poor ECG signal and disconnected PPG produce SENSOR_ERROR', () => {
  assert.equal(evaluateOverallRisk({ reading: reading({ ecgSignalQuality: 'POOR_SIGNAL' }), mlResult: ml() }).overallRisk, 'SENSOR_ERROR');
  assert.equal(evaluateOverallRisk({ reading: reading({ ppgSignalQuality: 'DISCONNECTED' }), mlResult: ml() }).overallRisk, 'SENSOR_ERROR');
});
test('persistent abnormal vitals produce HIGH_RISK', () => {
  const abnormal = reading({ spo2: 88 });
  assert.equal(evaluateOverallRisk({ reading: abnormal, mlResult: ml(), recentReadings: [abnormal, abnormal] }).overallRisk, 'HIGH_RISK');
});
test('stale readings produce STALE_DATA', () => {
  assert.equal(evaluateOverallRisk({ reading: reading({ timestamp: new Date(Date.now() - 60_000).toISOString() }), mlResult: ml() }).overallRisk, 'STALE_DATA');
});
test('invalid payloads are rejected without inventing values', () => {
  const payload = reading({ spo2: null, spo2Valid: false });
  assert.equal(validateReading(payload), null);
  assert.match(validateReading({ ...payload, spo2: 0 }), /spo2 must be null/);
});
test('HIGH Vital Risk ML classification produces HIGH_RISK', () => {
  const result = evaluateOverallRisk({ reading: reading(), mlResult: ml('LOW'), vitalMlResult: { riskLabel: 'HIGH' } });
  assert.equal(result.overallRisk, 'HIGH_RISK');
  assert.ok(result.reasons.includes('Vital Risk ML classification is HIGH'));
});

test('one abnormal vital reading does not produce HIGH_RISK when ML is LOW', () => {
  const abnormal = reading({ spo2: 88 });
  assert.equal(evaluateOverallRisk({ reading: abnormal, mlResult: ml(), vitalMlResult: { riskLabel: 'LOW' }, recentReadings: [abnormal] }).overallRisk, 'INSUFFICIENT_DATA');
});