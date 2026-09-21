const qualities = {
  ecg: new Set(['GOOD', 'POOR_SIGNAL', 'LEAD_OFF', 'NO_DATA', 'DISCONNECTED']),
  ppg: new Set(['GOOD', 'POOR', 'NO_FINGER', 'INVALID', 'DISCONNECTED'])
};

export function validateReading(payload) {
  const required = ['deviceId', 'timestamp', 'heartRateValid', 'spo2Valid', 'temperatureValid', 'ecgLeadOff', 'ecgSignalQuality', 'ppgSignalQuality', 'fingerDetected'];
  const missing = required.filter((key) => payload?.[key] === undefined);
  if (missing.length) return `Missing fields: ${missing.join(', ')}`;
  if (Number.isNaN(Date.parse(payload.timestamp))) return 'timestamp must be ISO-8601';
  if (!qualities.ecg.has(payload.ecgSignalQuality) || !qualities.ppg.has(payload.ppgSignalQuality)) return 'Invalid signal quality';
  for (const [value, valid] of [['heartRate', 'heartRateValid'], ['spo2', 'spo2Valid'], ['temperature', 'temperatureValid']]) {
    if (payload[valid] && (payload[value] === null || typeof payload[value] !== 'number' || !Number.isFinite(payload[value]))) return `${value} must be a finite number when valid`;
    if (!payload[valid] && payload[value] !== null) return `${value} must be null when invalid`;
  }
  if (!Array.isArray(payload.ecg ?? [])) return 'ecg must be an array';
  const allowedStatuses = {
    max30102Status: ['CONNECTED', 'NO_FINGER', 'POOR_SIGNAL', 'INVALID', 'DISCONNECTED'],
    ad8232Status: ['CONNECTED', 'GOOD_SIGNAL', 'POOR_SIGNAL', 'LEAD_OFF', 'NO_DATA', 'DISCONNECTED'],
    ds18b20Status: ['CONNECTED', 'INVALID', 'DISCONNECTED'],
    esp32Status: ['ONLINE', 'OFFLINE', 'STALE']
  };
  for (const [field, allowed] of Object.entries(allowedStatuses)) if (payload[field] !== undefined && payload[field] !== null && !allowed.includes(payload[field])) return `Invalid ${field}`;
  return null;
}