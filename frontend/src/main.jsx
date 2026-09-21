import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const timeFilters = ['1H', '6H', '24H', '7D', 'CUSTOM'];

// Custom theme hook
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('smart-health-theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('smart-health-theme', theme); }, [theme]);
  return [theme, () => setTheme((current) => current === 'dark' ? 'light' : 'dark')];
}

// Authentication custom hook (API calls and state 100% preserved)
function useAuth() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('smart_health_user');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('smart_health_token') || null);
  const [toast, setToast] = useState(null);

  const showToast = (text, type = 'success') => {
    setToast({ text, type });
    setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  const login = async (username, password) => {
    const res = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    localStorage.setItem('smart_health_user', JSON.stringify(data.user));
    localStorage.setItem('smart_health_token', data.token);
    setUser(data.user);
    setToken(data.token);
    showToast(`Logged in successfully as ${data.user.fullName || data.user.username}!`, 'success');
    return data;
  };

  const register = async (formData) => {
    const res = await fetch(`${apiUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');

    localStorage.setItem('smart_health_user', JSON.stringify(data.user));
    localStorage.setItem('smart_health_token', data.token);
    setUser(data.user);
    setToken(data.token);
    showToast(`Account created & logged in successfully!`, 'success');
    return data;
  };

  const logout = () => {
    localStorage.removeItem('smart_health_user');
    localStorage.removeItem('smart_health_token');
    setUser(null);
    setToken(null);
    showToast('Logged out successfully.', 'success');
    fetch(`${apiUrl}/auth/logout`, { method: 'POST' }).catch(() => {});
  };

  return { user, token, login, register, logout, toast, setToast };
}

// Dashboard real-time sensor polling hook (API calls and state 100% preserved)
function useDashboardData() {
  const [data, setData] = useState({ reading: null, ml: null, vitalMl: null, risk: null, history: [], alerts: [] });
  const [state, setState] = useState('CONNECTING');
  const [loading, setLoading] = useState(true);
  const lastPredictedTimestamp = useRef(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const latestResponse = await fetch(`${apiUrl}/readings/latest`);
        if (!latestResponse.ok) throw new Error('API unavailable');
        const reading = await latestResponse.json();
        if (!active) return;
        const deviceQuery = reading?.deviceId ? `?deviceId=${encodeURIComponent(reading.deviceId)}` : '';
        const [historyResponse, alertsResponse] = await Promise.all([
          fetch(`${apiUrl}/readings/history${deviceQuery}`),
          fetch(`${apiUrl}/alerts${deviceQuery}`)
        ]);
        let ml = null;
        let vitalMl = null;
        if (reading?.ecg?.length && reading.ecgSignalQuality === 'GOOD' && !reading.ecgLeadOff && reading.timestamp !== lastPredictedTimestamp.current) {
          const prediction = await fetch(`${apiUrl}/ml/predict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ecg: reading.ecg, ecgSignalQuality: reading.ecgSignalQuality, ecgLeadOff: reading.ecgLeadOff, deviceId: reading.deviceId, patientId: reading.patientId }) });
          if (prediction.ok) { ml = await prediction.json(); }
        }
        if (reading?.heartRateValid && reading?.spo2Valid && reading?.temperatureValid && reading.timestamp !== lastPredictedTimestamp.current) {
          const vitalPrediction = await fetch(`${apiUrl}/ml/predict/vital`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ heartRate: reading.heartRate, spo2: reading.spo2, temperature: reading.temperature, deviceId: reading.deviceId, patientId: reading.patientId }) });
          if (vitalPrediction.ok) { vitalMl = await vitalPrediction.json(); }
        }
        if (reading?.timestamp) { lastPredictedTimestamp.current = reading.timestamp; }

        if (!reading?.ecg?.length || reading.ecgSignalQuality !== 'GOOD' || reading.ecgLeadOff) {
          await fetch(`${apiUrl}/risk/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: reading?.deviceId, patientId: reading?.patientId }) });
        }
        const [riskResponse, mlResponse, vitalMlResponse] = await Promise.all([
          fetch(`${apiUrl}/risk/latest${deviceQuery}`),
          fetch(`${apiUrl}/ml/results/latest${deviceQuery}`),
          fetch(`${apiUrl}/ml/results/vital/latest${deviceQuery}`)
        ]);
        if (active) {
          setData({
            reading,
            ml: ml || (mlResponse.ok ? await mlResponse.json() : null),
            vitalMl: vitalMl || (vitalMlResponse.ok ? await vitalMlResponse.json() : null),
            risk: riskResponse.ok ? await riskResponse.json() : null,
            history: historyResponse.ok ? await historyResponse.json() : [],
            alerts: alertsResponse.ok ? await alertsResponse.json() : []
          });
          setState(reading ? 'LIVE' : 'NO DATA');
          setLoading(false);
        }
      } catch { if (active) { setState('CONNECTION ERROR'); setLoading(false); } }
    };
    load();
    const timer = setInterval(load, 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return { ...data, state, loading };
}

// UI Components
function StatusBadge({ children, tone = 'neutral' }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

function Skeleton({ className = '' }) {
  return <div className={`skeleton-box ${className}`} aria-hidden="true" />;
}

function EmptyState({ title = 'NO DATA', detail = 'Waiting for real sensor telemetry.' }) {
  return (
    <div className="empty-state-box">
      <strong>{title}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Panel({ eyebrow, title, action, children, className = '' }) {
  return (
    <section className={`glass-panel ${className}`}>
      <div className="panel-header">
        <div>
          {eyebrow && <p className="panel-eyebrow">{eyebrow}</p>}
          {title && <h2 className="panel-title">{title}</h2>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function metricStatus(status, valid) {
  if (!status && valid === undefined) return ['NO DATA', 'neutral'];
  if (status === 'GOOD' || status === 'CONNECTED' || status === 'GOOD_SIGNAL' || valid === true) return ['OPTIMAL', 'good'];
  if (status === 'DISCONNECTED' || status === 'LEAD_OFF' || status === 'POOR_SIGNAL') return [status.replace('_', ' '), 'danger'];
  return [status?.replace('_', ' ') || 'UNAVAILABLE', 'warning'];
}

function MetricCard({ label, value, unit, status, valid, device, history, field, accent }) {
  const [statusLabel, tone] = metricStatus(status, valid);
  const values = (history || []).map((item) => item[field]).filter((item) => typeof item === 'number');
  const trend = values.length > 1 ? values[values.length - 1] - values[0] : null;

  return (
    <article className={`metric-card accent-${accent}`}>
      <div className="metric-top-bar">
        <div className="metric-icon-box">
          {accent === 'mint' ? '♥' : accent === 'blue' ? '◌' : accent === 'amber' ? '°' : '⌁'}
        </div>
        <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
      </div>
      <p className="metric-label-text">{label}</p>
      <div className="metric-main-value">
        {value == null ? <span>--</span> : <><strong>{value}</strong><small>{unit}</small></>}
      </div>
      <div className="metric-footer">
        <span>{device}</span>
        {trend == null ? (
          <span>Trend sync...</span>
        ) : (
          <span style={{ color: trend >= 0 ? 'var(--emerald)' : 'var(--rose)' }}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)} trend
          </span>
        )}
      </div>
    </article>
  );
}

function Waveform({ samples }) {
  if (!samples?.length) return <EmptyState title="NO ECG SIGNAL" detail="Live AD8232 waveform trace will display here once connected." />;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = max - min || 1;
  const points = samples.map((sample, index) => `${(index * 100 / Math.max(samples.length - 1, 1)).toFixed(2)},${(92 - ((sample - min) / span) * 75).toFixed(2)}`).join(' ');

  return (
    <div className="ecg-screen">
      <div className="ecg-grid-lines" />
      <div className="ecg-center-baseline" />
      <svg className="ecg-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Real-time ECG trace">
        <defs>
          <filter id="ecgGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <polyline className="ecg-polyline" points={points} filter="url(#ecgGlow)" />
      </svg>
      <div className="ecg-live-indicator">
        <span className="ecg-live-dot" />
        <span>LIVE 250 Hz · AD8232</span>
      </div>
    </div>
  );
}

function TrendChart({ history, field, color, unit, filter, height = 130 }) {
  const chronological = [...(history || [])].reverse();
  const points = chronological.map((item) => item[field]).filter((value) => typeof value === 'number');
  
  if (!points.length) {
    return <EmptyState title="NO HISTORY" detail={`No data points recorded for ${filter}.`} />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const latest = points[points.length - 1];
  const avg = (points.reduce((a, b) => a + b, 0) / points.length).toFixed(1);
  const span = max - min || (min > 0 ? min * 0.1 : 1);
  const chartId = `grad-${field}-${Math.random().toString(36).substring(2, 7)}`;

  let polylinePoints = '';
  let areaPoints = '';

  if (points.length === 1) {
    const y = (85 - ((points[0] - min) / span) * 60).toFixed(2);
    polylinePoints = `0,${y} 100,${y}`;
    areaPoints = `0,${y} 100,${y} 100,95 0,95`;
  } else {
    const coords = points.map((val, idx) => {
      const x = (idx * 100 / (points.length - 1)).toFixed(2);
      const y = (85 - ((val - min) / span) * 60).toFixed(2);
      return `${x},${y}`;
    });
    polylinePoints = coords.join(' ');
    areaPoints = `${coords.join(' ')} 100,95 0,95`;
  }

  const latestY = (85 - ((latest - min) / span) * 60).toFixed(2);

  return (
    <div className="single-chart-card">
      <div className="chart-heading-wrap">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase' }}>
            {field === 'heartRate' ? 'Heart Rate' : field === 'spo2' ? 'Blood Oxygen' : 'Body Temperature'}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({unit})</span>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <strong style={{ fontSize: '15px', color }}>{latest}</strong>
          <small style={{ fontSize: '10px', color: 'var(--text-muted)' }}>latest</small>
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', height: `${height}px`, margin: '6px 0' }}>
        <svg className="trend-svg-container" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${unit} trendline`}>
          <defs>
            <linearGradient id={chartId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.06)" strokeDasharray="3,3" strokeWidth="0.6" />
          <line x1="0" y1="55" x2="100" y2="55" stroke="rgba(255,255,255,0.06)" strokeDasharray="3,3" strokeWidth="0.6" />
          <line x1="0" y1="85" x2="100" y2="85" stroke="rgba(255,255,255,0.06)" strokeDasharray="3,3" strokeWidth="0.6" />

          {/* Area fill */}
          <polygon points={areaPoints} fill={`url(#${chartId})`} />

          {/* Trend line */}
          <polyline className="trend-poly" style={{ stroke: color, strokeWidth: '2.5' }} points={polylinePoints} />

          {/* Latest reading pulse circle */}
          <circle cx="100" cy={latestY} r="3" fill={color} stroke="#ffffff" strokeWidth="1.5" />
        </svg>
      </div>

      <div className="trend-meta-footer">
        <span>Min: <b>{min.toFixed(1)}</b></span>
        <span>Avg: <b>{avg}</b></span>
        <span>Max: <b>{max.toFixed(1)}</b></span>
      </div>
    </div>
  );
}

function DevicePanel({ reading }) {
  const items = [
    ['ESP32 Node', reading?.esp32Status || (reading ? 'ONLINE' : 'OFFLINE')],
    ['MAX30102 PPG', reading?.max30102Status || reading?.ppgSignalQuality],
    ['AD8232 ECG', reading?.ad8232Status || reading?.ecgSignalQuality],
    ['DS18B20 Temp', reading?.ds18b20Status || (reading?.temperatureValid ? 'CONNECTED' : reading ? 'DISCONNECTED' : 'OFFLINE')],
    ['Wi-Fi Signal', reading?.wifiRssi == null ? 'NO DATA' : `${reading.wifiRssi} dBm`]
  ];

  return (
    <Panel eyebrow="HARDWARE STATUS" title="Sensor Mesh Network">
      <div>
        {items.map(([name, status]) => (
          <div className="hardware-row" key={name}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{name}</span>
            <StatusBadge tone={status === 'ONLINE' || status === 'CONNECTED' || status === 'GOOD' ? 'good' : status === 'OFFLINE' || status === 'NO DATA' ? 'neutral' : 'warning'}>
              {status?.replaceAll('_', ' ') || 'NO DATA'}
            </StatusBadge>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// User Authentication Modal (Login & Register)
function AuthModal({ isOpen, onClose, auth }) {
  const [tab, setTab] = useState('login');
  const [formData, setFormData] = useState({ username: '', email: '', password: '', fullName: '', role: 'Doctor', patientId: 'PATIENT-101' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (tab === 'login') {
        await auth.login(formData.username, formData.password);
      } else {
        await auth.register(formData);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close modal">✕</button>
        
        <p className="panel-eyebrow" style={{ color: 'var(--emerald)' }}>CLINICAL PORTAL ACCESS</p>
        <h2>{tab === 'login' ? 'Welcome Back' : 'Create Provider Account'}</h2>
        <p className="subtle" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {tab === 'login' ? 'Sign in to access patient records and live diagnostics.' : 'Register new medical staff credentials.'}
        </p>

        <div className="auth-tabs">
          <button type="button" className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); setError(null); }}>
            Log In
          </button>
          <button type="button" className={`auth-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => { setTab('register'); setError(null); }}>
            Register User
          </button>
        </div>

        {error && <div className="alert-banner danger">{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {tab === 'register' && (
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input type="text" name="fullName" required className="form-control" placeholder="Dr. Jane Smith" value={formData.fullName} onChange={handleChange} />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Username</label>
            <input type="text" name="username" required className="form-control" placeholder="janesmith" value={formData.username} onChange={handleChange} />
          </div>

          {tab === 'register' && (
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input type="email" name="email" required className="form-control" placeholder="jane@hospital.com" value={formData.email} onChange={handleChange} />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Password</label>
            <input type="password" name="password" required className="form-control" placeholder="••••••••" value={formData.password} onChange={handleChange} />
          </div>

          {tab === 'register' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">User Role</label>
                <select name="role" className="form-control" value={formData.role} onChange={handleChange}>
                  <option value="Doctor">Doctor</option>
                  <option value="Nurse">Nurse</option>
                  <option value="Admin">Admin</option>
                  <option value="Patient">Patient</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Patient ID (Optional)</label>
                <input type="text" name="patientId" className="form-control" placeholder="PATIENT-101" value={formData.patientId} onChange={handleChange} />
              </div>
            </div>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px', padding: '12px' }} disabled={loading}>
            {loading ? 'Authenticating...' : (tab === 'login' ? 'Sign In to System' : 'Create User Account')}
          </button>
        </form>
      </div>
    </div>
  );
}

// Report Share Modal Component
function ShareModal({ isOpen, onClose, shareData }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !shareData) return null;

  const { url, patientId, title } = shareData;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: title || `Medical Report - ${patientId}`,
          text: `Clinical Health Monitoring Report for Patient ${patientId}`,
          url: url
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Native share failed:', err);
        }
      }
    }
  };

  const whatsappMessage = `*Smart Health Report*\nPatient: ${patientId}\nTitle: ${title}\nDownload PDF: ${url}`;
  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappMessage)}`;
  
  const emailSubject = `Smart Health Report - Patient ${patientId}`;
  const emailBody = `Hello,\n\nPlease find the medical diagnostic report for Patient ${patientId} (${title}).\n\nYou can access and download the PDF report here:\n${url}\n\nGenerated automatically by Smart Health Monitoring System.`;
  const emailUrl = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card share-modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close modal">✕</button>
        <p className="panel-eyebrow" style={{ color: 'var(--emerald)' }}>SHARE REPORT</p>
        <h2>Share Medical Report</h2>
        <p className="subtle" style={{ marginBottom: '18px', fontSize: '13px', color: 'var(--text-muted)' }}>
          Share report for <strong>{patientId}</strong> directly via messaging, email, or device apps.
        </p>

        <div className="share-actions-stack">
          {typeof navigator !== 'undefined' && !!navigator.share && (
            <button 
              onClick={handleNativeShare}
              className="share-action-btn"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#ffffff' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              Share via Any App (Device Menu)
            </button>
          )}

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="share-action-btn"
            style={{ background: '#25D366', color: '#ffffff' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.96 9.96 0 0 0 1.333 4.993L2 22l5.233-1.371a9.92 9.92 0 0 0 4.773 1.226h.004c5.505 0 9.99-4.478 9.99-9.985C22.003 6.478 17.518 2 12.012 2zm6.7 14.183c-.276.779-1.353 1.431-1.85 1.48-.48.048-.962.228-3.076-.607-2.544-1.004-4.178-3.578-4.305-3.748-.127-.17-.927-1.233-.927-2.35 0-1.117.584-1.666.792-1.892.208-.227.453-.284.604-.284.15 0 .302.002.434.008.138.006.32-.054.498.378.185.44.636 1.547.692 1.66.056.113.094.246.019.397-.075.151-.113.245-.226.377-.113.132-.239.294-.34.396-.113.113-.23.236-.098.463.132.227.587.967 1.26 1.569.868.775 1.597 1.016 1.824 1.13.227.113.359.094.49-.057.132-.151.567-.66.717-.887.151-.227.302-.189.51-.113.208.076 1.32.623 1.547.737.227.113.377.17.434.269.056.099.056.566-.22 1.345z"/>
            </svg>
            Share on WhatsApp
          </a>

          <a
            href={emailUrl}
            className="share-action-btn"
            style={{ background: '#3b82f6', color: '#ffffff' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            Send via Email
          </a>

          <button
            onClick={handleCopy}
            className="share-action-btn"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
          >
            {copied ? (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--emerald)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span style={{ color: 'var(--emerald)' }}>Link Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copy Download Link
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Reports System View Component
function ReportsView({ auth, defaultPatientId = 'PATIENT-101' }) {
  const [reportType, setReportType] = useState('COMPREHENSIVE_HEALTH');
  const [patientId, setPatientId] = useState(defaultPatientId);
  const [timeRange, setTimeRange] = useState('24H');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [shareData, setShareData] = useState(null);

  const fetchPreview = async () => {
    setLoadingPreview(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;

      const res = await fetch(`${apiUrl}/reports/preview`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reportType, patientId, timeRange })
      });
      if (res.ok) {
        setPreview(await res.json());
      }
    } catch (err) {
      console.error('Error loading report preview:', err);
    } finally {
      setLoadingPreview(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${apiUrl}/reports/history?patientId=${encodeURIComponent(patientId)}`);
      if (res.ok) {
        setHistory(await res.json());
      }
    } catch (err) {
      console.error('Error fetching report history:', err);
    }
  };

  useEffect(() => {
    fetchPreview();
    fetchHistory();
  }, [reportType, patientId, timeRange]);

  const handleGenerate = async () => {
    setGenerating(true);
    setStatusMsg(null);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;

      const res = await fetch(`${apiUrl}/reports/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reportType, patientId, timeRange, notes })
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMsg({ type: 'success', text: `Report '${data.reportId}' generated & saved in MongoDB! Click 'Download PDF' to save to device.` });
        fetchHistory();
        setNotes('');
      } else {
        throw new Error(data.error || 'Failed to generate report');
      }
    } catch (err) {
      setStatusMsg({ type: 'danger', text: err.message });
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = (reportId) => {
    const downloadUrl = `${apiUrl}/reports/${reportId || 'preview'}/download?patientId=${encodeURIComponent(patientId)}&reportType=${encodeURIComponent(reportType)}&timeRange=${encodeURIComponent(timeRange)}`;
    window.open(downloadUrl, '_blank');
  };

  const handleOpenShare = (reportId, customTitle) => {
    const downloadUrl = `${apiUrl}/reports/${reportId || 'preview'}/download?patientId=${encodeURIComponent(patientId)}&reportType=${encodeURIComponent(reportType)}&timeRange=${encodeURIComponent(timeRange)}`;
    setShareData({
      url: downloadUrl,
      patientId: patientId,
      title: customTitle || `${reportType.replaceAll('_', ' ')} Report`
    });
  };

  const metrics = preview?.metricsSummary || {};
  const vitals = metrics.vitals || {};
  const risk = metrics.risk || {};
  const ecgMl = metrics.ecgMl || {};
  const vitalMl = metrics.vitalMl || {};

  return (
    <div className="reports-layout">
      <div>
        <p className="panel-eyebrow">CLINICAL INTELLIGENCE / REPORTING SYSTEM</p>
        <h1 style={{ fontSize: '28px', margin: '4px 0' }}>Clinical Telemetry & PDF Reports</h1>
        <p className="subtle" style={{ color: 'var(--text-muted)' }}>Preview, generate, and share structured medical documentation from MongoDB telemetry.</p>
      </div>

      {statusMsg && <div className={`alert-banner ${statusMsg.type}`}>{statusMsg.text}</div>}

      {/* Report Builder Parameters */}
      <div className="report-builder-card">
        <p className="panel-eyebrow">CONFIGURATION</p>
        <h2>Report Parameters</h2>

        <div className="report-controls-grid">
          <div className="form-group">
            <label className="form-label">Report Category</label>
            <select className="form-control" value={reportType} onChange={(e) => setReportType(e.target.value)}>
              <option value="COMPREHENSIVE_HEALTH">Comprehensive Health Summary</option>
              <option value="ECG_DIAGNOSTIC">ECG Diagnostic Report</option>
              <option value="VITAL_SIGNS_SUMMARY">Vital Signs Summary</option>
              <option value="ALERT_RISK_AUDIT">Alert & Risk Audit</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Target Patient ID</label>
            <input type="text" className="form-control" value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="PATIENT-101" />
          </div>

          <div className="form-group">
            <label className="form-label">Time Window</label>
            <select className="form-control" value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
              <option value="1H">Past 1 Hour</option>
              <option value="6H">Past 6 Hours</option>
              <option value="24H">Past 24 Hours</option>
              <option value="7D">Past 7 Days</option>
            </select>
          </div>

          <div className="form-group" style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={fetchPreview} disabled={loadingPreview} style={{ flex: 1 }}>
              {loadingPreview ? '...' : 'Refresh'}
            </button>
            <button className="btn btn-emerald" onClick={handleGenerate} disabled={generating} style={{ flex: 1.5 }}>
              {generating ? 'Generating...' : '⚡ Generate'}
            </button>
          </div>
        </div>

        <div className="form-group" style={{ marginTop: '14px' }}>
          <label className="form-label">Physician Remarks / Clinical Notes (Optional)</label>
          <input type="text" className="form-control" placeholder="Add clinical notes to embed directly in the generated PDF..." value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* Paper Style Live Preview */}
      <div className="report-paper-preview">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <p className="panel-eyebrow">LIVE DOCUMENT PREVIEW</p>
            <h2>{reportType.replaceAll('_', ' ')}</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={() => handleOpenShare(null, `${reportType.replaceAll('_', ' ')} Report for ${patientId}`)}>
              🔗 Share
            </button>
            <button className="btn btn-primary" onClick={() => handleDownload()}>
              📄 Download PDF
            </button>
          </div>
        </div>

        <div className="report-meta-box">
          <div className="meta-item">
            <span>Timestamp</span>
            <strong>{new Date().toLocaleString()}</strong>
          </div>
          <div className="meta-item">
            <span>Physician / Creator</span>
            <strong>{auth.user ? `${auth.user.fullName} (${auth.user.role})` : 'Doctor (System)'}</strong>
          </div>
          <div className="meta-item">
            <span>Patient ID</span>
            <strong style={{ color: 'var(--emerald)' }}>{patientId}</strong>
          </div>
          <div className="meta-item">
            <span>Document Status</span>
            <StatusBadge tone="good">GENERATED</StatusBadge>
          </div>
        </div>

        {/* Risk Callout */}
        <div className={`risk-hero-card tone-${risk.overallRisk === 'HIGH_RISK' ? 'danger' : risk.overallRisk === 'LOW_RISK' ? 'good' : 'warning'}`} style={{ marginBottom: '18px' }}>
          <div className="risk-orb-badge">{risk.overallRisk === 'HIGH_RISK' ? '!' : '✓'}</div>
          <div className="risk-hero-info">
            <p className="panel-eyebrow">OVERALL RISK LEVEL</p>
            <h2>{risk.overallRisk?.replaceAll('_', ' ') || 'EVALUATING'}</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Computed from real telemetry & ML classification models.</p>
          </div>
        </div>

        {/* Vitals Summary Table */}
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vital Metric</th>
                <th>Average Recorded</th>
                <th>Min / Max Range</th>
                <th>Clinical State</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Heart Rate (BPM)</strong></td>
                <td>{vitals.avgHeartRate != null ? `${vitals.avgHeartRate} BPM` : 'N/A'}</td>
                <td>{vitals.minHeartRate != null ? `${vitals.minHeartRate} - ${vitals.maxHeartRate} BPM` : 'N/A'}</td>
                <td><StatusBadge tone={vitals.avgHeartRate && (vitals.avgHeartRate < 60 || vitals.avgHeartRate > 100) ? 'warning' : 'good'}>{vitals.avgHeartRate ? 'OPTIMAL' : 'NO DATA'}</StatusBadge></td>
              </tr>
              <tr>
                <td><strong>Blood Oxygen (% SpO2)</strong></td>
                <td>{vitals.avgSpo2 != null ? `${vitals.avgSpo2}%` : 'N/A'}</td>
                <td>{vitals.minSpo2 != null ? `${vitals.minSpo2}% - ${vitals.maxSpo2}%` : 'N/A'}</td>
                <td><StatusBadge tone={vitals.avgSpo2 && vitals.avgSpo2 < 95 ? 'danger' : 'good'}>{vitals.avgSpo2 ? 'OPTIMAL' : 'NO DATA'}</StatusBadge></td>
              </tr>
              <tr>
                <td><strong>Body Temperature (°C)</strong></td>
                <td>{vitals.avgTemp != null ? `${vitals.avgTemp}°C` : 'N/A'}</td>
                <td>{vitals.minTemp != null ? `${vitals.minTemp}°C - ${vitals.maxTemp}°C` : 'N/A'}</td>
                <td><StatusBadge tone={vitals.avgTemp && (vitals.avgTemp < 36.1 || vitals.avgTemp > 37.5) ? 'warning' : 'good'}>{vitals.avgTemp ? 'OPTIMAL' : 'NO DATA'}</StatusBadge></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Stored Reports History Table */}
      <div className="report-builder-card">
        <p className="panel-eyebrow">DATABASE ARCHIVE</p>
        <h2>Stored MongoDB Reports ({history.length})</h2>

        {history.length === 0 ? (
          <EmptyState title="NO STORED REPORTS" detail="Click '⚡ Generate' above to create and store your first clinical PDF report in MongoDB." />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Report ID</th>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Staff</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item._id}>
                    <td><code style={{ color: 'var(--emerald)' }}>{item.reportId}</code></td>
                    <td><strong>{item.title}</strong></td>
                    <td>{item.reportType.replaceAll('_', ' ')}</td>
                    <td><StatusBadge tone="good">{item.status}</StatusBadge></td>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.createdByUsername}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => handleDownload(item._id)}>
                          📄 PDF
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => handleOpenShare(item._id, item.title)}>
                          🔗 Share
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Share Modal Dialog */}
      <ShareModal 
        isOpen={Boolean(shareData)} 
        onClose={() => setShareData(null)} 
        shareData={shareData} 
      />
    </div>
  );
}

// ==========================================================================
// DISTINCT CLINICAL ANALYTICS VIEW COMPONENT
// ==========================================================================
function AnalyticsView({ history = [], reading, ml, vitalMl, risk }) {
  const [filter, setFilter] = useState('24H');
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'hr', 'spo2', 'temp', 'ecg', 'raw'
  const [searchQuery, setSearchQuery] = useState('');

  const chronological = useMemo(() => [...(history || [])].reverse(), [history]);

  const hrVals = useMemo(() => chronological.map((h) => h.heartRate).filter((v) => typeof v === 'number'), [chronological]);
  const spo2Vals = useMemo(() => chronological.map((h) => h.spo2).filter((v) => typeof v === 'number'), [chronological]);
  const tempVals = useMemo(() => chronological.map((h) => h.temperature).filter((v) => typeof v === 'number'), [chronological]);

  const hrAvg = hrVals.length ? (hrVals.reduce((a, b) => a + b, 0) / hrVals.length).toFixed(1) : '--';
  const hrMin = hrVals.length ? Math.min(...hrVals) : '--';
  const hrMax = hrVals.length ? Math.max(...hrVals) : '--';
  const hrAbnormal = hrVals.filter((v) => v < 60 || v > 100).length;

  const spo2Avg = spo2Vals.length ? (spo2Vals.reduce((a, b) => a + b, 0) / spo2Vals.length).toFixed(1) : '--';
  const spo2Min = spo2Vals.length ? Math.min(...spo2Vals) : '--';
  const spo2Max = spo2Vals.length ? Math.max(...spo2Vals) : '--';
  const spo2Hypoxic = spo2Vals.filter((v) => v < 92).length;

  const tempAvg = tempVals.length ? (tempVals.reduce((a, b) => a + b, 0) / tempVals.length).toFixed(1) : '--';
  const tempMin = tempVals.length ? Math.min(...tempVals) : '--';
  const tempMax = tempVals.length ? Math.max(...tempVals) : '--';
  const tempFever = tempVals.filter((v) => v > 38.0).length;

  // Filtered raw telemetry
  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history;
    const q = searchQuery.toLowerCase();
    return history.filter((item) => 
      item.deviceId?.toLowerCase().includes(q) ||
      item.patientId?.toLowerCase().includes(q) ||
      item.ecgSignalQuality?.toLowerCase().includes(q)
    );
  }, [history, searchQuery]);

  const exportCSV = () => {
    if (!history.length) return;
    const headers = ['Timestamp', 'Device ID', 'Patient ID', 'Heart Rate (BPM)', 'SpO2 (%)', 'Temperature (°C)', 'ECG Lead Off', 'ECG Quality', 'Finger Detected'];
    const rows = history.map((r) => [
      new Date(r.timestamp).toISOString(),
      r.deviceId,
      r.patientId || 'N/A',
      r.heartRate ?? '',
      r.spo2 ?? '',
      r.temperature ?? '',
      r.ecgLeadOff ? 'TRUE' : 'FALSE',
      r.ecgSignalQuality || '',
      r.fingerDetected ? 'TRUE' : 'FALSE'
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `smart_health_telemetry_${reading?.patientId || 'patient'}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="reports-layout analytics-container">
      {/* Analytics Header */}
      <div className="analytics-header-banner">
        <div>
          <p className="panel-eyebrow" style={{ color: 'var(--cyan)' }}>DIAGNOSTIC INTELLIGENCE & TELEMETRY HUB</p>
          <h1 style={{ fontSize: '28px', margin: '4px 0' }}>Biometric Analytics & Historical Trends</h1>
          <p className="subtle" style={{ color: 'var(--text-muted)' }}>
            Deep-dive multi-channel sensor telemetry, MIT-BIH Arrhythmia CNN statistics, and time-series distributions.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div className="time-filter-pills">
            {timeFilters.map((item) => (
              <button 
                key={item} 
                className={`time-filter-btn ${filter === item ? 'active' : ''}`} 
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <button className="btn btn-outline btn-sm" onClick={exportCSV}>
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* Analytics KPI Matrix Strip */}
      <section className="metrics-grid">
        <article className="metric-card accent-mint">
          <div className="metric-top-bar">
            <div className="metric-icon-box">♥</div>
            <StatusBadge tone={hrAbnormal > 0 ? 'warning' : 'good'}>
              {hrAbnormal > 0 ? `${hrAbnormal} OUTLIERS` : 'OPTIMAL'}
            </StatusBadge>
          </div>
          <p className="metric-label-text">Mean HR: {hrAvg} BPM</p>
          <div className="metric-main-value">
            <strong>{reading?.heartRate ?? '--'}</strong><small>BPM</small>
          </div>
          <div className="metric-footer">
            <span>Range: {hrMin} - {hrMax} BPM</span>
            <span style={{ color: 'var(--emerald)' }}>Target: 60-100</span>
          </div>
        </article>

        <article className="metric-card accent-blue">
          <div className="metric-top-bar">
            <div className="metric-icon-box">◌</div>
            <StatusBadge tone={spo2Hypoxic > 0 ? 'danger' : 'good'}>
              {spo2Hypoxic > 0 ? `${spo2Hypoxic} HYPOXIA` : 'OPTIMAL'}
            </StatusBadge>
          </div>
          <p className="metric-label-text">Mean SpO2: {spo2Avg}%</p>
          <div className="metric-main-value">
            <strong>{reading?.spo2 ?? '--'}</strong><small>%</small>
          </div>
          <div className="metric-footer">
            <span>Range: {spo2Min}% - {spo2Max}%</span>
            <span style={{ color: 'var(--blue)' }}>Target: &gt;95%</span>
          </div>
        </article>

        <article className="metric-card accent-amber">
          <div className="metric-top-bar">
            <div className="metric-icon-box">°</div>
            <StatusBadge tone={tempFever > 0 ? 'warning' : 'good'}>
              {tempFever > 0 ? `${tempFever} FEVER` : 'OPTIMAL'}
            </StatusBadge>
          </div>
          <p className="metric-label-text">Mean Temp: {tempAvg}°C</p>
          <div className="metric-main-value">
            <strong>{reading?.temperature ?? '--'}</strong><small>°C</small>
          </div>
          <div className="metric-footer">
            <span>Range: {tempMin}°C - {tempMax}°C</span>
            <span style={{ color: 'var(--amber)' }}>Norm: 36.1-37.5</span>
          </div>
        </article>

        <article className="metric-card accent-rose">
          <div className="metric-top-bar">
            <div className="metric-icon-box">🧠</div>
            <StatusBadge tone={ml?.riskLabel === 'HIGH' ? 'danger' : 'good'}>
              {ml?.riskLabel || 'AI EVAL'}
            </StatusBadge>
          </div>
          <p className="metric-label-text">MIT-BIH Arrhythmia CNN</p>
          <div className="metric-main-value">
            <strong>{ml?.riskProbability != null ? `${(ml.riskProbability * 100).toFixed(0)}%` : '--'}</strong>
            <small>conf</small>
          </div>
          <div className="metric-footer">
            <span>ECG: {reading?.ecgLeadOff ? 'LEAD OFF' : 'CONNECTED'}</span>
            <span style={{ color: 'var(--purple)' }}>Rate: 250 Hz</span>
          </div>
        </article>
      </section>

      {/* Interactive Visualizer Navigation Tabs */}
      <div className="analytics-channel-tabs">
        {[
          { id: 'all', label: '📊 Multi-Channel Matrix', desc: 'All vitals synchronized' },
          { id: 'hr', label: '🫀 Heart Rate Focus', desc: 'Tachy/Bradycardia trend' },
          { id: 'spo2', label: '◌ Blood Oxygen (SpO2)', desc: 'Hypoxia desaturation' },
          { id: 'temp', label: '🌡 Body Temperature', desc: 'Thermal drift curve' },
          { id: 'ecg', label: '⌁ ECG Oscilloscope', desc: '187-pt Lead trace' },
          { id: 'raw', label: '📑 Telemetry Records', desc: `${history.length} stored samples` }
        ].map((tab) => (
          <button
            key={tab.id}
            className={`analytics-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <strong>{tab.label}</strong>
            <small>{tab.desc}</small>
          </button>
        ))}
      </div>

      {/* Tab View 1: Multi-Channel Synchronized View */}
      {activeTab === 'all' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Panel eyebrow="MULTI-CHANNEL STREAM" title="Continuous Real-Time Biometric Trendlines">
            <div className="charts-trio">
              <TrendChart history={history} field="heartRate" color="var(--emerald)" unit="BPM" filter={filter} height={140} />
              <TrendChart history={history} field="spo2" color="var(--blue)" unit="%" filter={filter} height={140} />
              <TrendChart history={history} field="temperature" color="var(--amber)" unit="°C" filter={filter} height={140} />
            </div>
          </Panel>

          {/* Clinical Health Correlation Index */}
          <div className="analytics-correlation-card">
            <div className="correlation-info">
              <p className="panel-eyebrow">DIAGNOSTIC CORRELATION MATRIX</p>
              <h2>Biometric Telemetry Integrity & Stability Score</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Aggregated scoring evaluated from continuous MAX30102 PPG pulse wave, AD8232 ECG Lead integrity, and DS18B20 1-Wire precision sensors.
              </p>
              <div className="correlation-pills-row">
                <span className="cor-pill">
                  <strong style={{ color: 'var(--emerald)' }}>{((1 - (hrAbnormal + spo2Hypoxic + tempFever) / Math.max(history.length * 3, 1)) * 100).toFixed(1)}%</strong>
                  <span>Stability Index</span>
                </span>
                <span className="cor-pill">
                  <strong style={{ color: 'var(--cyan)' }}>{history.length}</strong>
                  <span>Total Ingested Readings</span>
                </span>
                <span className="cor-pill">
                  <strong style={{ color: 'var(--purple)' }}>{vitalMl?.riskLabel || 'LOW'}</strong>
                  <span>Vital ML Classification</span>
                </span>
                <span className="cor-pill">
                  <strong style={{ color: reading?.esp32Status === 'ONLINE' ? 'var(--emerald)' : 'var(--amber)' }}>{reading?.esp32Status || 'ONLINE'}</strong>
                  <span>Hardware Node Status</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab View 2: Heart Rate Deep-Dive */}
      {activeTab === 'hr' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Panel eyebrow="CARDIOVASCULAR TELEMETRY" title="High-Resolution Heart Rate Trend (BPM)">
            <TrendChart history={history} field="heartRate" color="var(--emerald)" unit="BPM" filter={filter} height={260} />
            <div className="analytics-deep-dive-footer">
              <div className="dive-stat-box">
                <span>Baseline Mean</span>
                <strong>{hrAvg} BPM</strong>
              </div>
              <div className="dive-stat-box">
                <span>Minimum HR</span>
                <strong>{hrMin} BPM</strong>
              </div>
              <div className="dive-stat-box">
                <span>Maximum Peak</span>
                <strong>{hrMax} BPM</strong>
              </div>
              <div className="dive-stat-box">
                <span>Healthy Zone (60-100)</span>
                <strong style={{ color: 'var(--emerald)' }}>
                  {hrVals.length ? `${(((hrVals.length - hrAbnormal) / hrVals.length) * 100).toFixed(0)}%` : '--'}
                </strong>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* Tab View 3: SpO2 Deep-Dive */}
      {activeTab === 'spo2' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Panel eyebrow="OXYGENATION TELEMETRY" title="Blood Oxygen Saturation (SpO2 %)">
            <TrendChart history={history} field="spo2" color="var(--blue)" unit="%" filter={filter} height={260} />
            <div className="analytics-deep-dive-footer">
              <div className="dive-stat-box">
                <span>Mean Saturation</span>
                <strong>{spo2Avg}%</strong>
              </div>
              <div className="dive-stat-box">
                <span>Minimum Saturation</span>
                <strong style={{ color: spo2Min < 92 ? 'var(--rose)' : 'var(--blue)' }}>{spo2Min}%</strong>
              </div>
              <div className="dive-stat-box">
                <span>Desaturations (&lt;92%)</span>
                <strong style={{ color: spo2Hypoxic > 0 ? 'var(--rose)' : 'var(--emerald)' }}>{spo2Hypoxic} events</strong>
              </div>
              <div className="dive-stat-box">
                <span>Clinical Target (&gt;95%)</span>
                <strong style={{ color: 'var(--blue)' }}>
                  {spo2Vals.length ? `${(((spo2Vals.length - spo2Hypoxic) / spo2Vals.length) * 100).toFixed(0)}%` : '--'}
                </strong>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* Tab View 4: Temperature Deep-Dive */}
      {activeTab === 'temp' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Panel eyebrow="THERMAL TELEMETRY" title="Precision Body Temperature (°C)">
            <TrendChart history={history} field="temperature" color="var(--amber)" unit="°C" filter={filter} height={260} />
            <div className="analytics-deep-dive-footer">
              <div className="dive-stat-box">
                <span>Mean Temperature</span>
                <strong>{tempAvg}°C</strong>
              </div>
              <div className="dive-stat-box">
                <span>Lowest Temperature</span>
                <strong>{tempMin}°C</strong>
              </div>
              <div className="dive-stat-box">
                <span>Highest Temperature</span>
                <strong style={{ color: tempMax > 38.0 ? 'var(--rose)' : 'var(--amber)' }}>{tempMax}°C</strong>
              </div>
              <div className="dive-stat-box">
                <span>Fever Threshold (&gt;38°C)</span>
                <strong style={{ color: tempFever > 0 ? 'var(--rose)' : 'var(--emerald)' }}>{tempFever} events</strong>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* Tab View 5: ECG Oscilloscope View */}
      {activeTab === 'ecg' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Panel 
            eyebrow="ELECTROCARDIOGRAM" 
            title="Real-Time 187-Point ECG Oscilloscope" 
            action={<StatusBadge tone={reading?.ecgSignalQuality === 'GOOD' ? 'good' : 'warning'}>{reading?.ecgSignalQuality || 'NO SIGNAL'}</StatusBadge>}
          >
            <Waveform samples={reading?.ecg} />
            <div className="ecg-meta-bar">
              <span>LEADS: <b>{reading ? reading.ecgLeadOff ? 'OFF' : 'CONNECTED' : 'N/A'}</b></span>
              <span>HARDWARE: <b>AD8232 (ADC1_CH6)</b></span>
              <span>BUFFER: <b>{reading?.ecg?.length || 0} / 187 samples</b></span>
              <span>AI CONFIDENCE: <b>{ml?.riskProbability != null ? `${(ml.riskProbability * 100).toFixed(1)}%` : 'N/A'}</b></span>
            </div>
          </Panel>
        </div>
      )}

      {/* Tab View 6: Raw Telemetry Stream Table */}
      {activeTab === 'raw' && (
        <div className="report-builder-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
            <div>
              <p className="panel-eyebrow">DATABASE LOG</p>
              <h2>Raw Sensor Telemetry Records ({filteredHistory.length})</h2>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input 
                type="text" 
                className="form-control" 
                placeholder="Search device, patient..." 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)} 
                style={{ width: '220px', padding: '6px 12px', fontSize: '13px' }}
              />
              <button className="btn btn-secondary btn-sm" onClick={exportCSV}>
                Download CSV
              </button>
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <EmptyState title="NO MATCHING RECORDS" detail="No telemetry records match your search query." />
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Device ID</th>
                    <th>Patient ID</th>
                    <th>Heart Rate</th>
                    <th>SpO2</th>
                    <th>Temperature</th>
                    <th>ECG Leads</th>
                    <th>Signal Quality</th>
                    <th>Finger Sensor</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.slice(0, 25).map((item, idx) => (
                    <tr key={item._id || idx}>
                      <td><small style={{ fontFamily: 'var(--font-mono)' }}>{new Date(item.timestamp).toLocaleTimeString()}</small></td>
                      <td><code>{item.deviceId}</code></td>
                      <td><strong style={{ color: 'var(--emerald)' }}>{item.patientId || 'N/A'}</strong></td>
                      <td>{item.heartRate != null ? `${item.heartRate} BPM` : '--'}</td>
                      <td>{item.spo2 != null ? `${item.spo2}%` : '--'}</td>
                      <td>{item.temperature != null ? `${item.temperature}°C` : '--'}</td>
                      <td>
                        <StatusBadge tone={item.ecgLeadOff ? 'danger' : 'good'}>
                          {item.ecgLeadOff ? 'OFF' : 'CONNECTED'}
                        </StatusBadge>
                      </td>
                      <td>
                        <StatusBadge tone={item.ecgSignalQuality === 'GOOD' ? 'good' : 'warning'}>
                          {item.ecgSignalQuality || 'OK'}
                        </StatusBadge>
                      </td>
                      <td>
                        <StatusBadge tone={item.fingerDetected ? 'good' : 'neutral'}>
                          {item.fingerDetected ? 'DETECTED' : 'NO'}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================================================
// DISTINCT CLINICAL SURVEILLANCE & ALERTS VIEW COMPONENT
// ==========================================================================
function AlertsView({ alerts = [], reading }) {
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [acknowledgedIds, setAcknowledgedIds] = useState(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL', 'ACTIVE', 'ACKNOWLEDGED'

  const toggleAcknowledge = (id) => {
    setAcknowledgedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const markAllAcknowledged = () => {
    const all = new Set(alerts.map((a) => a._id || `${a.timestamp}-${a.message}`));
    setAcknowledgedIds(all);
  };

  const filteredAlerts = alerts.filter((a) => {
    const id = a._id || `${a.timestamp}-${a.message}`;
    const isAck = acknowledgedIds.has(id);
    if (statusFilter === 'ACTIVE' && isAck) return false;
    if (statusFilter === 'ACKNOWLEDGED' && !isAck) return false;
    if (severityFilter !== 'ALL' && a.severity !== severityFilter) return false;
    if (categoryFilter !== 'ALL' && a.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match = a.message?.toLowerCase().includes(q) ||
                    a.patientId?.toLowerCase().includes(q) ||
                    a.deviceId?.toLowerCase().includes(q) ||
                    a.category?.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const criticalCount = alerts.filter((a) => a.severity === 'CRITICAL').length;
  const warningCount = alerts.filter((a) => a.severity === 'WARNING').length;
  const activeUnackCount = alerts.filter((a) => !acknowledgedIds.has(a._id || `${a.timestamp}-${a.message}`)).length;

  const hasCriticalActive = alerts.some((a) => a.severity === 'CRITICAL' && !acknowledgedIds.has(a._id || `${a.timestamp}-${a.message}`));

  return (
    <div className="reports-layout alerts-container">
      {/* Alerts Header */}
      <div className="alerts-header-banner">
        <div>
          <p className="panel-eyebrow" style={{ color: 'var(--rose)' }}>CLINICAL SURVEILLANCE & TRIAGE CENTER</p>
          <h1 style={{ fontSize: '28px', margin: '4px 0' }}>Real-Time Clinical Incident Alerts</h1>
          <p className="subtle" style={{ color: 'var(--text-muted)' }}>
            Surveillance incident log triggered by dual machine learning models, biometric limits, and hardware lead state changes.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={markAllAcknowledged}>
            ✓ Acknowledge All ({alerts.length})
          </button>
        </div>
      </div>

      {/* Active Critical Incident Hero Callout */}
      {hasCriticalActive && (
        <section className="risk-hero-card tone-danger alert-pulse-box">
          <div className="risk-orb-badge" style={{ background: 'var(--rose)', color: '#ffffff' }}>!</div>
          <div className="risk-hero-info">
            <p className="panel-eyebrow" style={{ color: 'var(--rose)' }}>CRITICAL CLINICAL INCIDENT DETECTED</p>
            <h2>High-Risk Telemetry Condition Active</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              Immediate medical evaluation advised. One or more sensor channels or ML classification models have detected critical anomaly values.
            </p>
          </div>
        </section>
      )}

      {/* Surveillance KPI Counters */}
      <section className="metrics-grid">
        <article className="metric-card accent-rose">
          <div className="metric-top-bar">
            <div className="metric-icon-box">!</div>
            <StatusBadge tone="danger">CRITICAL</StatusBadge>
          </div>
          <p className="metric-label-text">Critical Incidents</p>
          <div className="metric-main-value">
            <strong>{criticalCount}</strong><small>events</small>
          </div>
          <div className="metric-footer">
            <span>Overall Risk / Arrhythmia</span>
          </div>
        </article>

        <article className="metric-card accent-amber">
          <div className="metric-top-bar">
            <div className="metric-icon-box">⚠</div>
            <StatusBadge tone="warning">WARNINGS</StatusBadge>
          </div>
          <p className="metric-label-text">Vital Sign Drifts</p>
          <div className="metric-main-value">
            <strong>{warningCount}</strong><small>events</small>
          </div>
          <div className="metric-footer">
            <span>ML & Threshold Warnings</span>
          </div>
        </article>

        <article className="metric-card accent-mint">
          <div className="metric-top-bar">
            <div className="metric-icon-box">✓</div>
            <StatusBadge tone={activeUnackCount > 0 ? 'warning' : 'good'}>
              {activeUnackCount > 0 ? `${activeUnackCount} PENDING` : 'CLEARED'}
            </StatusBadge>
          </div>
          <p className="metric-label-text">Triage Status</p>
          <div className="metric-main-value">
            <strong>{alerts.length - activeUnackCount} / {alerts.length}</strong>
          </div>
          <div className="metric-footer">
            <span>Acknowledged by Staff</span>
          </div>
        </article>

        <article className="metric-card accent-blue">
          <div className="metric-top-bar">
            <div className="metric-icon-box">🔌</div>
            <StatusBadge tone={reading?.esp32Status === 'ONLINE' ? 'good' : 'warning'}>
              {reading?.esp32Status || 'ONLINE'}
            </StatusBadge>
          </div>
          <p className="metric-label-text">Hardware Node</p>
          <div className="metric-main-value">
            <strong style={{ fontSize: '16px' }}>{reading?.deviceId || 'ESP32_HEALTH'}</strong>
          </div>
          <div className="metric-footer">
            <span>WiFi: {reading?.wifiRssi != null ? `${reading.wifiRssi} dBm` : 'USB Serial'}</span>
          </div>
        </article>
      </section>

      {/* Incident Triage Filter Bar */}
      <div className="report-builder-card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          {/* Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Status:</span>
            {[
              { id: 'ALL', label: 'All Incidents' },
              { id: 'ACTIVE', label: `Pending (${activeUnackCount})` },
              { id: 'ACKNOWLEDGED', label: `Acknowledged (${acknowledgedIds.size})` }
            ].map((st) => (
              <button
                key={st.id}
                className="btn btn-sm"
                onClick={() => setStatusFilter(st.id)}
                style={{
                  background: statusFilter === st.id ? 'var(--bg-card)' : 'var(--bg-elevated)',
                  color: statusFilter === st.id ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: statusFilter === st.id ? '1px solid var(--border-focus)' : '1px solid var(--border-subtle)'
                }}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Severity Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Severity:</span>
            {['ALL', 'CRITICAL', 'WARNING'].map((sev) => (
              <button
                key={sev}
                className="btn btn-sm"
                onClick={() => setSeverityFilter(sev)}
                style={{
                  background: severityFilter === sev ? (sev === 'CRITICAL' ? 'var(--rose)' : sev === 'WARNING' ? 'var(--amber)' : 'var(--emerald)') : 'var(--bg-elevated)',
                  color: severityFilter === sev ? '#ffffff' : 'var(--text-muted)'
                }}
              >
                {sev}
              </button>
            ))}
          </div>

          {/* Category Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Category:</span>
            <select
              className="form-control"
              style={{ width: 'auto', padding: '5px 10px', fontSize: '12px' }}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="ALL">All Categories</option>
              <option value="OVERALL_RISK">Overall Health Risk</option>
              <option value="ECG_ML">ECG ML Arrhythmia</option>
              <option value="VITAL_ML">Vital Signs ML</option>
            </select>
          </div>

          {/* Search Input */}
          <input
            type="text"
            className="form-control"
            placeholder="Search incident text..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '200px', padding: '5px 10px', fontSize: '12px' }}
          />
        </div>
      </div>

      {/* Incident Cards Timeline */}
      <div className="report-builder-card">
        <p className="panel-eyebrow">INCIDENT STREAM</p>
        <h2>Surveillance Audit Log ({filteredAlerts.length} shown)</h2>

        {filteredAlerts.length === 0 ? (
          <EmptyState title="NO MATCHING ALERTS" detail="No active or historical alerts matching your selected triage filters." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
            {filteredAlerts.map((alert) => {
              const alertId = alert._id || `${alert.timestamp}-${alert.message}`;
              const isAck = acknowledgedIds.has(alertId);

              return (
                <div
                  key={alertId}
                  className={`incident-item-card ${isAck ? 'ack-card' : ''}`}
                  style={{
                    padding: '16px 20px',
                    background: isAck ? 'rgba(255,255,255,0.02)' : 'var(--bg-elevated)',
                    borderRadius: 'var(--radius-md)',
                    borderLeft: `4px solid ${alert.severity === 'CRITICAL' ? 'var(--rose)' : 'var(--amber)'}`,
                    borderTop: '1px solid var(--border-subtle)',
                    borderRight: '1px solid var(--border-subtle)',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '14px',
                    opacity: isAck ? 0.7 : 1
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '75%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <StatusBadge tone={alert.severity === 'CRITICAL' ? 'danger' : 'warning'}>
                        {alert.severity}
                      </StatusBadge>
                      <span className="category-pill-tag">
                        {alert.category?.replace('_', ' ')}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--emerald)', fontFamily: 'var(--font-mono)' }}>
                        Patient: {alert.patientId || '--'}
                      </span>
                      {isAck && (
                        <span style={{ fontSize: '11px', color: 'var(--emerald)', fontWeight: 600 }}>
                          ✓ Acknowledged
                        </span>
                      )}
                    </div>

                    <strong style={{ fontSize: '15px', color: 'var(--text-primary)', lineHeight: 1.3 }}>
                      {alert.message}
                    </strong>

                    <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      <span>Device: <code>{alert.deviceId}</code></span>
                      <span>Recorded: {new Date(alert.timestamp).toLocaleString()}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                    <button
                      className={`btn btn-sm ${isAck ? 'btn-outline' : 'btn-emerald'}`}
                      onClick={() => toggleAcknowledge(alertId)}
                    >
                      {isAck ? 'Undo Acknowledge' : '✓ Acknowledge'}
                    </button>
                    <small style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      ID: {String(alertId).slice(-6)}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hardware Mesh Diagnostic Sub-panel */}
      <div className="report-builder-card">
        <p className="panel-eyebrow">HARDWARE MESH STATUS</p>
        <h2>Connected Sensor Health Diagnostics</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '10px' }}>
          {[
            { name: 'ESP32 Core Microcontroller', status: reading?.esp32Status || 'ONLINE', info: '240 MHz Dual-Core' },
            { name: 'MAX30102 PPG Sensor', status: reading?.max30102Status || (reading?.fingerDetected ? 'CONNECTED' : 'NO_FINGER'), info: 'Red (660nm) + IR (880nm)' },
            { name: 'AD8232 ECG Front-End', status: reading?.ad8232Status || (reading?.ecgLeadOff ? 'LEAD_OFF' : 'GOOD_SIGNAL'), info: '3-Lead Cardio Trace (250Hz)' },
            { name: 'DS18B20 Temperature Probe', status: reading?.ds18b20Status || (reading?.temperatureValid ? 'CONNECTED' : 'INVALID'), info: '1-Wire Digital Thermal Sensor' }
          ].map((sensor) => (
            <div key={sensor.name} style={{ padding: '12px 14px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <strong style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{sensor.name}</strong>
                <StatusBadge tone={sensor.status === 'ONLINE' || sensor.status === 'CONNECTED' || sensor.status === 'GOOD_SIGNAL' ? 'good' : sensor.status === 'LEAD_OFF' || sensor.status === 'NO_FINGER' ? 'warning' : 'neutral'}>
                  {sensor.status.replaceAll('_', ' ')}
                </StatusBadge>
              </div>
              <small style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{sensor.info}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Auto-dismissing Toast Notification Component
function ToastNotification({ toast }) {
  if (!toast) return null;
  return (
    <div className="toast-container">
      <div className={`toast-pill ${toast.type}`}>
        <span style={{ color: toast.type === 'success' ? 'var(--emerald)' : 'var(--rose)', fontWeight: 800 }}>
          {toast.type === 'success' ? '✓' : 'ℹ'}
        </span>
        <span>{toast.text}</span>
      </div>
    </div>
  );
}

// Clinical Landing Page & Mandatory Authentication Gateway
function LandingPage({ auth, theme, toggleTheme }) {
  const [tab, setTab] = useState('login');
  const [formData, setFormData] = useState({ username: '', email: '', password: '', fullName: '', role: 'Doctor', patientId: 'PATIENT-101' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (tab === 'login') {
        await auth.login(formData.username, formData.password);
      } else {
        await auth.register(formData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing-wrapper">
      <div className="landing-glow-bg" />
      <ToastNotification toast={auth.toast} />

      {/* Landing Header */}
      <header className="landing-nav">
        <div className="sidebar-brand" style={{ padding: 0, border: 'none' }}>
          <div className="brand-icon-wrap">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div className="brand-info">
            <h2>Smart Health</h2>
            <span>Clinical IoT SaaS</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="theme-toggle-btn" onClick={toggleTheme} aria-label="Toggle Theme" title="Toggle Theme">
            {theme === 'dark' ? '☼' : '☾'}
          </button>
        </div>
      </header>

      {/* Hero Section with Auth Gate */}
      <main className="landing-hero-container">
        {/* Hero Left: Product Value & Clinical Specs */}
        <div>
          <div className="landing-badge">
            <span className="sync-dot" />
            <span>CLINICAL IoT CLOUD TELEMETRY</span>
          </div>

          <h1 className="landing-title">
            Smart Health Monitoring & <em>AI Diagnostic Suite</em>
          </h1>

          <p className="landing-subtitle">
            Enterprise-grade biometric monitoring with real-time sensor telemetry, deep learning arrhythmia detection, and automated clinical PDF reporting.
          </p>

          <div className="landing-features-grid">
            <div className="landing-feature-card">
              <span className="feat-icon">🫀</span>
              <strong>Live Vital Telemetry</strong>
              <small>Real-time PPG (MAX30102), ECG (AD8232), and Precision Temperature (DS18B20).</small>
            </div>
            <div className="landing-feature-card">
              <span className="feat-icon">🧠</span>
              <strong>Dual AI / ML Models</strong>
              <small>MIT-BIH Arrhythmia CNN and Scikit-Learn Vital Signs classification.</small>
            </div>
            <div className="landing-feature-card">
              <span className="feat-icon">📄</span>
              <strong>Clinical PDF Reports</strong>
              <small>One-click medical documentation with WhatsApp & Email sharing.</small>
            </div>
            <div className="landing-feature-card">
              <span className="feat-icon">🔒</span>
              <strong>HIPAA-Ready Portal</strong>
              <small>Role-based access control for Doctors, Nurses, and Staff.</small>
            </div>
          </div>

          <div className="landing-stats-bar">
            <div className="landing-stat-item">
              <strong>99.9%</strong>
              <span>Telemetry Uptime</span>
            </div>
            <div className="landing-stat-item">
              <strong>187 pts</strong>
              <span>ECG Sample Buffer</span>
            </div>
            <div className="landing-stat-item">
              <strong>2 ML Models</strong>
              <span>Real-Time Inference</span>
            </div>
            <div className="landing-stat-item">
              <strong>&lt; 1 sec</strong>
              <span>Sync Latency</span>
            </div>
          </div>
        </div>

        {/* Hero Right: Sign In / Register Auth Card */}
        <div className="landing-auth-card">
          <p className="panel-eyebrow" style={{ color: 'var(--emerald)' }}>PROVIDER ACCESS PORTAL</p>
          <h2 style={{ fontSize: '22px', margin: '4px 0 6px' }}>{tab === 'login' ? 'Sign In to System' : 'Create Staff Account'}</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
            {tab === 'login' ? 'Enter your credentials to unlock patient telemetry.' : 'Register a new clinical team member.'}
          </p>

          <div className="auth-tabs">
            <button type="button" className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); setError(null); }}>
              Sign In
            </button>
            <button type="button" className={`auth-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => { setTab('register'); setError(null); }}>
              Register
            </button>
          </div>

          {error && <div className="alert-banner danger">{error}</div>}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {tab === 'register' && (
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input type="text" name="fullName" required className="form-control" placeholder="Dr. Jane Smith" value={formData.fullName} onChange={handleChange} />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Username</label>
              <input type="text" name="username" required className="form-control" placeholder="janesmith" value={formData.username} onChange={handleChange} />
            </div>

            {tab === 'register' && (
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input type="email" name="email" required className="form-control" placeholder="jane@hospital.com" value={formData.email} onChange={handleChange} />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Password</label>
              <input type="password" name="password" required className="form-control" placeholder="••••••••" value={formData.password} onChange={handleChange} />
            </div>

            {tab === 'register' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select name="role" className="form-control" value={formData.role} onChange={handleChange}>
                    <option value="Doctor">Doctor</option>
                    <option value="Nurse">Nurse</option>
                    <option value="Admin">Admin</option>
                    <option value="Patient">Patient</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Patient ID</label>
                  <input type="text" name="patientId" className="form-control" placeholder="PATIENT-101" value={formData.patientId} onChange={handleChange} />
                </div>
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '8px', padding: '12px' }} disabled={loading}>
              {loading ? 'Authenticating...' : (tab === 'login' ? 'Sign In & Access Dashboard' : 'Create Staff Account')}
            </button>
          </form>
        </div>
      </main>

      {/* Landing Footer */}
      <footer className="landing-footer">
        <span>© 2026 Smart Health Monitoring System · Clinical SaaS Platform</span>
        <span>Secure Telemetry · Real MongoDB Cloud Data · Machine Learning Active</span>
      </footer>
    </div>
  );
}

// Main App Shell Component
function App() {
  const [theme, toggleTheme] = useTheme();
  const auth = useAuth();
  const { reading, ml, vitalMl, risk, history, alerts, state, loading } = useDashboardData();
  const [currentNav, setCurrentNav] = useState('dashboard');
  const [filter, setFilter] = useState('1H');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Mandatory Authentication: If user is not logged in, display Landing Page & Auth Portal
  if (!auth.user) {
    return <LandingPage auth={auth} theme={theme} toggleTheme={toggleTheme} />;
  }

  const stale = false;
  const connection = state;
  const riskLabel = risk?.overallRisk?.replaceAll('_', ' ') || 'NO DATA';
  const riskTone = risk?.overallRisk === 'HIGH_RISK' ? 'danger' : risk?.overallRisk === 'LOW_RISK' ? 'good' : 'warning';
  const riskReasons = Array.isArray(risk?.reasons) ? risk.reasons : ['Waiting for a complete, fresh sensor assessment.'];

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'reports', label: 'Reports System', icon: '📑' },
    { id: 'analytics', label: 'Analytics', icon: '📈' },
    { id: 'alerts', label: 'Alerts', icon: '🔔', badge: (alerts && alerts.length) || null }
  ];

  return (
    <div className="app-container">
      <ToastNotification toast={auth.toast} />

      {/* Mobile Drawer Backdrop Overlay */}
      <div 
        className={`sidebar-backdrop ${mobileMenuOpen ? 'active' : ''}`} 
        onClick={() => setMobileMenuOpen(false)} 
        aria-hidden="true"
      />

      {/* SaaS Left Sidebar */}
      <aside className={`app-sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-icon-wrap">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div className="brand-info">
            <h2>Smart Health</h2>
            <span>Clinical IoT SaaS</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-section-title">Navigation</span>
          {navItems.map((item) => (
            <div
              key={item.id}
              className={`nav-item ${currentNav === item.id ? 'active' : ''}`}
              onClick={() => { setCurrentNav(item.id); setMobileMenuOpen(false); }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
              {item.badge != null && <span className="nav-badge">{item.badge}</span>}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-patient-card">
            <span className="sidebar-patient-label">Active Monitored Patient</span>
            <div className="sidebar-patient-id">
              <span className="sync-dot" />
              <span>{reading?.patientId || '--'}</span>
            </div>
            <small style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
              Device: {reading?.deviceId || '--'}
            </small>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="app-main-wrapper">
        {/* Top Navbar */}
        <header className="app-header">
          <div className="header-left">
            <button className="mobile-menu-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle Navigation Menu">
              ☰
            </button>
            <div className="header-breadcrumb">
              <span className="breadcrumb-category">Clinical SaaS / Monitoring</span>
              <span className="breadcrumb-title">
                {currentNav === 'dashboard' ? 'Real-Time Biometrics Dashboard' : 
                 currentNav === 'reports' ? 'Clinical Reports & Intelligence' : 
                 currentNav === 'analytics' ? 'Vitals Telemetry Analytics' : 'Active Alerts & Audits'}
              </span>
            </div>
          </div>

          <div className="header-right">
            {/* IoT Telemetry Sync Pill */}
            <div className="sync-pill">
              <span className={`sync-dot ${stale ? 'stale' : state === 'LIVE' ? '' : 'disconnected'}`} />
              <span>{connection}</span>
              <small style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {reading ? new Date(reading.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'NO SYNC'}
              </small>
            </div>

            {/* Dark / Light Mode Switch */}
            <button className="theme-toggle-btn" onClick={toggleTheme} aria-label="Toggle Theme" title="Toggle Theme">
              {theme === 'dark' ? '☼' : '☾'}
            </button>

            {/* User Profile Pill / Auth Trigger */}
            {auth.user ? (
              <div className="user-profile-pill">
                <div className="user-avatar">
                  {auth.user.fullName?.slice(0, 2).toUpperCase() || auth.user.username?.slice(0, 2).toUpperCase() || 'DR'}
                </div>
                <div className="user-details">
                  <span className="user-name">{auth.user.fullName || auth.user.username}</span>
                  <span className="user-role-badge">{auth.user.role || 'Staff'}</span>
                </div>
                <button className="btn btn-outline btn-sm" onClick={auth.logout} style={{ marginLeft: '4px' }}>
                  Logout
                </button>
              </div>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => setIsAuthOpen(true)}>
                Sign In
              </button>
            )}
          </div>
        </header>

        {/* Auth Modal */}
        <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} auth={auth} />

        {/* Page Content Viewport */}
        <main className="page-viewport">
          {currentNav === 'reports' ? (
            <ReportsView auth={auth} defaultPatientId={reading?.patientId || ''} />
          ) : currentNav === 'analytics' ? (
            <AnalyticsView history={history} reading={reading} ml={ml} vitalMl={vitalMl} risk={risk} />
          ) : currentNav === 'alerts' ? (
            <AlertsView alerts={alerts} reading={reading} />
          ) : (
            <>
              {/* Risk Banner */}
              {loading ? (
                <div className="skeleton-box" style={{ height: '90px' }} />
              ) : (
                <section className={`risk-hero-card tone-${riskTone}`}>
                  <div className="risk-orb-badge">
                    {risk?.overallRisk === 'HIGH_RISK' ? '!' : risk?.overallRisk === 'LOW_RISK' ? '✓' : '—'}
                  </div>
                  <div className="risk-hero-info">
                    <p className="panel-eyebrow">AUTOMATED CLINICAL RISK EVALUATION</p>
                    <h2>{riskLabel}</h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                      Real-time risk scoring computed from multi-sensor telemetry, MIT-BIH Arrhythmia CNN, and Vital Signs Gradient Classifier.
                    </p>
                    <div className="risk-chips">
                      {riskReasons.slice(0, 3).map((reason) => (
                        <span className="risk-chip" key={reason}>
                          <span style={{ color: riskTone === 'danger' ? 'var(--rose)' : 'var(--emerald)' }}>●</span>
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {/* 4 Biometric Metric Cards */}
              <section className="metrics-grid">
                <MetricCard label="Heart Rate" value={reading?.heartRate} unit="BPM" valid={reading?.heartRateValid} status={reading?.max30102Status || reading?.ppgSignalQuality} device="MAX30102" history={history} field="heartRate" accent="mint" />
                <MetricCard label="Blood Oxygen" value={reading?.spo2} unit="% SpO2" valid={reading?.spo2Valid} status={reading?.max30102Status || reading?.ppgSignalQuality} device="MAX30102" history={history} field="spo2" accent="blue" />
                <MetricCard label="Body Temp" value={reading?.temperature} unit="°C" valid={reading?.temperatureValid} status={reading?.ds18b20Status} device="DS18B20" history={history} field="temperature" accent="amber" />
                <MetricCard label="ECG Buffer" value={reading?.ecg?.length ? `${reading.ecg.length}` : null} unit="samples" status={reading?.ad8232Status || reading?.ecgSignalQuality} device="AD8232" history={history} field="ecg" accent="rose" />
              </section>

              {/* Middle Section: ECG Monitor + Dual ML Models */}
              <section className="dashboard-grid">
                {/* Real-time Oscilloscope ECG */}
                <Panel 
                  eyebrow="ELECTROCARDIOGRAM" 
                  title="Real-Time ECG Waveform" 
                  action={<StatusBadge tone={reading?.ecgSignalQuality === 'GOOD' ? 'good' : 'warning'}>{reading?.ecgSignalQuality?.replaceAll('_', ' ') || 'NO SIGNAL'}</StatusBadge>}
                >
                  <Waveform samples={reading?.ecg} />
                  <div className="ecg-meta-bar">
                    <span>LEADS: <b>{reading ? reading.ecgLeadOff ? 'OFF' : 'CONNECTED' : 'N/A'}</b></span>
                    <span>HARDWARE: <b>AD8232</b></span>
                    <span>SAMPLES: <b>{reading?.ecg?.length || 0} / 187</b></span>
                    <span>SYNC: <b>{reading ? new Date(reading.timestamp).toLocaleTimeString() : '--:--:--'}</b></span>
                  </div>
                </Panel>

                {/* AI / ML Microservice Model Diagnostics */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <Panel eyebrow="MODEL 1" title="ECG Arrhythmia Classifier">
                    <div className="ml-card-body">
                      <div className={`ml-gauge ${ml?.riskLabel === 'HIGH' ? 'risk-high' : 'risk-low'}`}>
                        <strong style={{ color: ml?.riskLabel === 'HIGH' ? 'var(--rose)' : 'var(--emerald)' }}>{ml?.riskLabel || 'N/A'}</strong>
                        <small>RISK</small>
                      </div>
                      <div className="ml-stats-list">
                        <div className="ml-stat-row"><span>Confidence</span><strong>{ml?.riskProbability == null ? 'N/A' : `${(ml.riskProbability * 100).toFixed(1)}%`}</strong></div>
                        <div className="ml-stat-row"><span>Dataset</span><strong>MIT-BIH (187)</strong></div>
                        <div className="ml-stat-row"><span>Signal</span><strong>{ml?.signalQuality || 'GOOD'}</strong></div>
                      </div>
                    </div>
                  </Panel>

                  <Panel eyebrow="MODEL 2" title="Vital Signs Risk Model">
                    <div className="ml-card-body">
                      <div className={`ml-gauge ${vitalMl?.riskLabel === 'HIGH' ? 'risk-high' : 'risk-low'}`}>
                        <strong style={{ color: vitalMl?.riskLabel === 'HIGH' ? 'var(--rose)' : 'var(--emerald)' }}>{vitalMl?.riskLabel || 'N/A'}</strong>
                        <small>RISK</small>
                      </div>
                      <div className="ml-stats-list">
                        <div className="ml-stat-row"><span>Confidence</span><strong>{vitalMl?.riskProbability == null ? 'N/A' : `${(vitalMl.riskProbability * 100).toFixed(1)}%`}</strong></div>
                        <div className="ml-stat-row"><span>Features</span><strong>HR, SpO2, Temp</strong></div>
                        <div className="ml-stat-row"><span>Inference</span><strong>Scikit-Learn</strong></div>
                      </div>
                    </div>
                  </Panel>
                </div>
              </section>

              {/* Lower Section: Analytics Charts + Hardware & Alerts */}
              <section className="dashboard-grid">
                <Panel 
                  eyebrow="ANALYTICS" 
                  title="Historical Vitals Telemetry" 
                  action={
                    <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-elevated)', padding: '3px', borderRadius: 'var(--radius-sm)' }}>
                      {timeFilters.map((item) => (
                        <button 
                          key={item} 
                          className="btn btn-sm" 
                          onClick={() => setFilter(item)}
                          style={{ 
                            background: filter === item ? 'var(--bg-card)' : 'transparent',
                            color: filter === item ? 'var(--text-primary)' : 'var(--text-muted)',
                            boxShadow: filter === item ? 'var(--shadow-sm)' : 'none',
                            padding: '4px 8px'
                          }}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  }
                >
                  <div className="charts-trio">
                    <TrendChart history={history} field="heartRate" color="var(--emerald)" unit="BPM" filter={filter} />
                    <TrendChart history={history} field="spo2" color="var(--blue)" unit="%" filter={filter} />
                    <TrendChart history={history} field="temperature" color="var(--amber)" unit="°C" filter={filter} />
                  </div>
                </Panel>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <DevicePanel reading={reading} />

                  <Panel eyebrow="LIVE AUDIT" title="Recent Clinical Alerts" action={<span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{alerts?.length || 0} Total</span>}>
                    {alerts && alerts.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {alerts.slice(0, 3).map((alert) => (
                          <div key={alert._id || `${alert.timestamp}-${alert.message}`} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', borderLeft: `3px solid ${alert.severity === 'CRITICAL' ? 'var(--rose)' : 'var(--amber)'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                              <StatusBadge tone={alert.severity === 'CRITICAL' ? 'danger' : 'warning'}>{alert.category?.replace('_', ' ')}</StatusBadge>
                              <small style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{new Date(alert.timestamp).toLocaleTimeString()}</small>
                            </div>
                            <strong style={{ fontSize: '12px', color: 'var(--text-primary)', display: 'block' }}>{alert.message}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="NO ACTIVE ALERTS" detail="All sensors operating within clinical tolerances." />
                    )}
                  </Panel>
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="mobile-bottom-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`bottom-nav-item ${currentNav === item.id ? 'active' : ''}`}
            onClick={() => { setCurrentNav(item.id); setMobileMenuOpen(false); }}
            aria-label={item.label}
          >
            <span className="bottom-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.badge != null && <span className="bottom-nav-badge">{item.badge}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
