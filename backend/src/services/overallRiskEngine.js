import { riskRules } from '../config/riskRules.js';

function isFresh(reading, now) {
  const ts = reading?.timestamp ?? reading?.predictionTimestamp;
  return ts && (now - new Date(ts).getTime() <= riskRules.staleAfterMs);
}

function abnormalVitals(reading) {
  return {
    heartRate: reading.heartRateValid && (reading.heartRate < riskRules.heartRateMin || reading.heartRate > riskRules.heartRateMax),
    spo2: reading.spo2Valid && reading.spo2 < riskRules.spo2Min,
    temperature: reading.temperatureValid && (reading.temperature < riskRules.temperatureMin || reading.temperature > riskRules.temperatureMax)
  };
}

export function evaluateOverallRisk({ reading, mlResult, vitalMlResult, recentReadings = [], now = Date.now() }) {
  if (!reading) return result('INSUFFICIENT_DATA', ['No sensor reading is available']);
  if (!isFresh(reading, now)) return result('STALE_DATA', ['ESP32 reading is stale']);
  if (reading.ecgSignalQuality === 'LEAD_OFF' || reading.ecgSignalQuality === 'POOR_SIGNAL' || reading.ppgSignalQuality === 'POOR' || reading.ppgSignalQuality === 'INVALID' || reading.ppgSignalQuality === 'DISCONNECTED') {
    return result('SENSOR_ERROR', ['One or more sensor signals are poor or disconnected']);
  }

  const missing = [];
  if (!mlResult || mlResult.signalQuality !== 'GOOD' || (mlResult.predictionTimestamp && !isFresh(mlResult, now))) missing.push('ECG ML result is unavailable');
  if (!reading.heartRateValid) missing.push('Heart Rate is unavailable');
  if (!reading.spo2Valid) missing.push('SpO2 is unavailable');
  if (!reading.temperatureValid) missing.push('Temperature is unavailable');
  if (missing.length) return result('INSUFFICIENT_DATA', missing);

  const current = abnormalVitals(reading);
  const persistent = recentReadings.slice(0, riskRules.persistenceCount).length >= riskRules.persistenceCount && ['heartRate', 'spo2', 'temperature'].some((key) => recentReadings.slice(0, riskRules.persistenceCount).every((item) => abnormalVitals(item)[key]));
  const reasons = [];
  if (mlResult.riskLabel === 'HIGH') reasons.push('ECG ML classification is HIGH');
  if (vitalMlResult?.riskLabel === 'HIGH') reasons.push('Vital Risk ML classification is HIGH');
  if (persistent) reasons.push('A configured vital-sign abnormality persisted across consecutive readings');
  if (Object.values(current).some(Boolean) && !persistent && mlResult.riskLabel !== 'HIGH' && vitalMlResult?.riskLabel !== 'HIGH') return result('INSUFFICIENT_DATA', ['An abnormal vital reading requires persistence before risk is raised']);
  if (current.heartRate) reasons.push('Heart Rate is outside the engineering range');
  if (current.spo2) reasons.push('SpO2 is below the engineering range');
  if (current.temperature) reasons.push('Temperature is outside the engineering range');
  return result(reasons.length ? 'HIGH_RISK' : 'LOW_RISK', reasons.length ? reasons : ['All required readings are valid and no configured abnormality was detected']);
}

function result(overallRisk, reasons) {
  return { overallRisk, reasons, engineVersion: riskRules.engineVersion };
}