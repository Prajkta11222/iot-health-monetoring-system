// Engineering configuration only. These values are not clinical diagnostic thresholds.
export const riskRules = Object.freeze({
  engineVersion: '1.0',
  staleAfterMs: 30_000,
  persistenceCount: 2,
  heartRateMin: 50,
  heartRateMax: 120,
  spo2Min: 92,
  temperatureMin: 35,
  temperatureMax: 38.5
});