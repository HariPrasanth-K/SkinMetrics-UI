import { useState, useRef, useEffect } from "react";
import { invokeRppg, RPPG_ENDPOINT } from "../awsConfig";
import "./VitalSigns.css";

const METRICS = [
  { key:"heartRate",       label:"Heart Rate",             unit:"bpm",    icon:"❤️",  normal:[60,100],  color:"#ef4444" },
  { key:"respiratoryRate", label:"Respiratory Rate",       unit:"br/min", icon:"🌬️",  normal:[12,20],   color:"#3b82f6" },
  { key:"oxygenSat",       label:"Oxygen Saturation",      unit:"%",      icon:"🫁",  normal:[95,100],  color:"#06b6d4" },
  { key:"bloodPressure",   label:"Blood Pressure",         unit:"mmHg",   icon:"🩺",  normal:null,      color:"#8b5cf6" },
  { key:"stress",          label:"Stress Index",           unit:"/10",    icon:"🧠",  normal:[0,4],     color:"#f59e0b" },
  { key:"hrv",             label:"Heart Rate Variability", unit:"ms",     icon:"📈",  normal:[20,80],   color:"#22c55e" },
  { key:"hemoglobin",      label:"Hemoglobin",             unit:"g/dL",   icon:"🩸",  normal:[12,17],   color:"#dc2626" },
  { key:"hba1c",           label:"HbA1c",                  unit:"%",      icon:"🍬",  normal:[4,5.7],   color:"#d97706" },
];

function parseVitals(raw) {
  if (!raw) return null;
  if (raw.heartRate !== undefined) return raw;
  if (raw.heart_rate !== undefined)
    return { heartRate:raw.heart_rate, respiratoryRate:raw.respiratory_rate||raw.rr||"—", oxygenSat:raw.spo2||raw.oxygen_saturation||"—", bloodPressure:raw.blood_pressure||`${raw.systolic||"—"}/${raw.diastolic||"—"}`, stress:raw.stress_index||raw.stress||"—", hrv:raw.hrv||"—", hemoglobin:raw.hemoglobin||"—", hba1c:raw.hba1c||"—" };
  if (raw.predictions) {
    const p = raw.predictions;
    return { heartRate:p.HR||p.heart_rate||"—", respiratoryRate:p.RR||p.respiratory_rate||"—", oxygenSat:p.SpO2||p.spo2||"—", bloodPressure:p.BP||p.blood_pressure||"—", stress:p.stress||p.stress_index||"—", hrv:p.HRV||p.hrv||"—", hemoglobin:p.Hb||p.hemoglobin||"—", hba1c:p.HbA1c||p.hba1c||"—" };
  }
  return { heartRate:"—", respiratoryRate:"—", oxygenSat:"—", bloodPressure:"—", stress:"—", hrv:"—", hemoglobin:"—", hba1c:"—", _raw: JSON.stringify(raw).slice(0,400) };
}

export default function VitalSigns() {
  const [tab, setTab]           = useState("setup");     // setup | scan | results
  const [endpoint, setEndpoint] = useState(RPPG_ENDPOINT);
  const [phase, setPhase]       = useState("idle");      // idle | scanning | processing
  const [progress, setProgress] = useState(0);
  const [scanTime, setScanTime] = useState(60);
  const [vitals, setVitals]     = useState(null);
  const [scanError, setScanError] = useState("");
  // Contact forwarding
  const [contact, setContact]   = useState({ value:"", type:"email", enabled:false });
  const [sent, setSent]         = useState(false);
  const [sending, setSending]   = useState(false);

  const videoRef    = useRef();
  const streamRef   = useRef();
  const recorderRef = useRef();
  const chunksRef   = useRef([]);
  const timerRef    = useRef();

  // ── Start scan ─────────────────────────────────────────────────────
  async function startScan() {
    if (!endpoint) {
      setScanError("No rPPG endpoint configured yet. Complete the scan anyway to test the camera — results won't be available until the endpoint is deployed.");
    } else {
      setScanError("");
    }
    setPhase("scanning"); setProgress(0); setScanTime(60);
    chunksRef.current = [];

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"user", width:640, height:480 }, audio:false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
    } catch (e) {
      setScanError("Camera denied. Please allow camera access and try again."); setPhase("idle"); return;
    }

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm" : "video/mp4";

    const rec = new MediaRecorder(stream, { mimeType:mime });
    recorderRef.current = rec;
    rec.ondataavailable = e => { if (e.data.size>0) chunksRef.current.push(e.data); };
    rec.start(500);

    let elapsed = 0;
    timerRef.current = setInterval(() => {
      elapsed++;
      setProgress(Math.round(elapsed/60*100));
      setScanTime(60-elapsed);
      if (elapsed >= 60) { clearInterval(timerRef.current); finishScan(mime); }
    }, 1000);
  }

  async function finishScan(mime) {
    setPhase("processing");
    const rec = recorderRef.current;
    if (!rec) return;
    rec.onstop = async () => {
      stopCamera();
      const blob = new Blob(chunksRef.current, { type:mime });
      try {
        const raw = await invokeRppg(blob, endpoint);
        console.log("rPPG raw:", raw);
        setVitals(parseVitals(raw));
        setTab("results");
      } catch (e) {
        setScanError(`rPPG endpoint error: ${e.message}`);
        setPhase("idle");
      }
    };
    rec.stop();
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t=>t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setPhase("idle");
  }

  function reset() {
    clearInterval(timerRef.current);
    recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
    stopCamera();
    setProgress(0); setScanTime(60); setVitals(null); setSent(false);
    setScanError(""); setTab("scan");
  }

  useEffect(() => () => { clearInterval(timerRef.current); stopCamera(); }, []);

  // ── Build clean HTML report ──────────────────────────────────────────
  function buildReportHTML() {
    const date = new Date().toLocaleString();
    const rows = METRICS.map(m => {
      const val = vitals[m.key] ?? "—";
      const num = parseFloat(val);
      let status = "Normal";
      if (m.normal && !isNaN(num)) {
        if (num < m.normal[0]) status = "Low";
        else if (num > m.normal[1]) status = "High";
      }
      const statusColor = status==="Normal"?"#16a34a":status==="High"?"#dc2626":"#2563eb";
      const normalRange = m.normal ? `${m.normal[0]}–${m.normal[1]} ${m.unit}` : "—";
      return `
        <tr>
          <td>${m.icon} ${m.label}</td>
          <td><strong>${val}${val!=="—"?" "+m.unit:""}</strong></td>
          <td style="color:${statusColor};font-weight:600">${status}</td>
          <td style="color:#6b7280">${normalRange}</td>
        </tr>`;
    }).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Skin Analysis</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#111;padding:40px;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #16a34a;padding-bottom:20px;margin-bottom:28px;}
    .brand{display:flex;align-items:center;gap:12px;}
    .brand-icon{width:48px;height:48px;background:#16a34a;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;}
    .brand-name{font-size:24px;font-weight:700;color:#111;}
    .brand-sub{font-size:12px;color:#6b7280;margin-top:2px;}
    .report-info{text-align:right;font-size:12px;color:#6b7280;line-height:1.8;}
    .report-info strong{color:#111;}
    h2{font-size:16px;font-weight:700;color:#15803d;margin-bottom:14px;padding-bottom:6px;border-bottom:1.5px solid #dcfce7;}
    table{width:100%;border-collapse:collapse;margin-bottom:28px;font-size:14px;}
    th{background:#f0fdf4;padding:10px 14px;text-align:left;font-size:12px;color:#15803d;text-transform:uppercase;letter-spacing:.05em;font-weight:600;}
    td{padding:11px 14px;border-bottom:1px solid #f0f0f0;}
    tr:last-child td{border-bottom:none;}
    tr:hover td{background:#fafff9;}
    .summary{background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:24px;}
    .summary p{font-size:13px;color:#374151;line-height:1.7;}
    .footer{border-top:1px solid #e5e7eb;padding-top:16px;font-size:11px;color:#9ca3af;text-align:center;}
    .badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;}
    .badge-normal{background:#dcfce7;color:#15803d;}
    .badge-high{background:#fef2f2;color:#b91c1c;}
    .badge-low{background:#eff6ff;color:#1d4ed8;}
    @media print{body{padding:20px;}button{display:none!important;}}
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <div class="brand-icon">🧬</div>
      <div>
        <div class="brand-name">Skin Analysis</div>
        <div class="brand-sub">Face Scan</div>
      </div>
    </div>
    <div class="report-info">
      <div><strong>Report Date</strong><br/>${date}</div>
      <div style="margin-top:6px"><strong>Report Type</strong><br/>Vital Signs — rPPG Scan</div>
      ${contact.value ? `<div style="margin-top:6px"><strong>${contact.type==="email"?"Patient Email":"Patient Phone"}</strong><br/>${contact.value}</div>` : ""}
    </div>
  </div>

  <h2>Vital Signs Results</h2>
  <table>
    <thead>
      <tr>
        <th>Metric</th>
        <th>Value</th>
        <th>Status</th>
        <th>Normal Range</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Clinical Summary</h2>
  <div class="summary">
    <p>Results derived from a 60-second non-invasive rPPG (remote photoplethysmography) facial scan. The camera captured subtle skin colour changes caused by blood flow to estimate the above vital signs.</p>
    <p style="margin-top:8px"><strong>Note:</strong> For clinical decisions always cross-reference with physical examination and standard medical devices. Schedule follow-up in 4 weeks for trend monitoring.</p>
  </div>

  <div class="footer">
    Generated by Face Scan Health Report · ${date} · For medical professional use only
  </div>

  <script>window.onload=()=>window.print();</script>
</body>
</html>`;
  }

  // ── Print report in new window ───────────────────────────────────────
  function printReport() {
    const html = buildReportHTML();
    const win  = window.open("", "_blank", "width=800,height=900");
    win.document.write(html);
    win.document.close();
  }

  // ── Send result via email ────────────────────────────────────────────
  function sendResult() {
    if (!contact.value || !vitals) return;
    setSending(true);
    const lines = METRICS.map(m=>`${m.label}: ${vitals[m.key]??'—'} ${m.unit}`).join('\n');
    const body  = `DermAI Vital Signs Report\n\nScan Date: ${new Date().toLocaleString()}\n\n${lines}\n\nGenerated by DermAI Health Intelligence.`;
    if (contact.type === "email") {
      window.open(`mailto:${contact.value}?subject=DermAI Vital Signs Report&body=${encodeURIComponent(body)}`);
    }
    setTimeout(() => { setSending(false); setSent(true); }, 800);
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  function getStatus(key, val) {
    const m = METRICS.find(x=>x.key===key);
    if (!m?.normal || val==="—") return "normal";
    const n = parseFloat(val);
    if (isNaN(n)) return "normal";
    if (n < m.normal[0]) return "low";
    if (n > m.normal[1]) return "high";
    return "normal";
  }
  const ST = { normal:{label:"Normal",cls:"badge-green"}, low:{label:"Low",cls:"badge-blue"}, high:{label:"High",cls:"badge-orange"} };

  return (
    <div className="vs-page">
      <div className="page-hdr vs-hdr">
        <div>
          <h1>Vital Signs Monitor</h1>
          <p>Non-invasive rPPG biometric scan · Endpoint: <code style={{fontSize:11}}>{endpoint||"not configured"}</code></p>
        </div>
        {vitals && phase==="idle" && (
          <button className="btn btn-secondary" onClick={reset}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
            New Scan
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="vs-tabs">
        {[["setup","⚙️ Setup"],["scan","📷 Face Scan"],["results","📊 Results"]].map(([id,lbl])=>(
          <button
            key={id}
            className={`vs-tab ${tab===id?"active":""}`}
            onClick={()=>setTab(id)}
            disabled={id==="results"&&!vitals}
          >
            {lbl}
            {id==="results"&&vitals&&<span className="vs-dot"/>}
          </button>
        ))}
      </div>

      {/* ═══════════════ SETUP TAB ═══════════════ */}
      {tab === "setup" && (
        <div className="fade-up">
          <div className="card vs-setup-card">
            <div className="vs-setup-title">rPPG Model Configuration</div>
            <p className="vs-setup-sub">Configure the SageMaker endpoint that processes the 60-second face scan video and returns vital sign estimates.</p>

            {/* Model file status */}
            <div className="vs-model-status">
              <div className="vs-model-status-row">
                <div className="vs-model-icon">🧠</div>
                <div>
                  <div className="vs-model-name">SCAMPS_DeepPhys.pth</div>
                  <div className="vs-model-path">s3://mltrainingodf/open_rppg_models/open-rppg/SCAMPS/SCAMPS_DeepPhys.pth</div>
                </div>
                <span className="badge badge-orange">⏳ Not deployed</span>
              </div>
              <div className="alert alert-error" style={{marginTop:12}}>
                <div>
                  <strong>⚠ No SageMaker endpoint yet</strong><br/>
                  Your rPPG model (<code>.pth</code>) is stored in S3 but not yet deployed as a SageMaker endpoint.
                  The face scan feature will be disabled until you deploy it.<br/><br/>
                  <strong>To deploy:</strong> See the step-by-step guide below.
                </div>
              </div>
            </div>

            {/* Deploy guide */}
            <div className="vs-deploy-guide">
              <div className="vs-setup-title" style={{marginBottom:10}}>📋 How to deploy your .pth model to SageMaker</div>
              <div className="vs-how-list">
                {[
                  ["1","Go to AWS Console → SageMaker → Models → Create model"],
                  ["2","Container: use PyTorch inference image (e.g. 763104351884.dkr.ecr.ap-south-1.amazonaws.com/pytorch-inference:2.0.0-cpu-py310)"],
                  ["3","Model artifacts: point to s3://mltrainingodf/open_rppg_models/open-rppg/SCAMPS/SCAMPS_DeepPhys.pth"],
                  ["4","Create an Endpoint Configuration → choose instance type (ml.m5.large is cheapest)"],
                  ["5","Create Endpoint → wait ~5 minutes for status to become InService"],
                  ["6","Copy the endpoint name and paste it below"],
                ].map(([n,t])=>(
                  <div className="vs-how-item" key={n}>
                    <div className="vs-how-num">{n}</div>
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="divider"/>

            <div className="alert alert-info" style={{marginBottom:20}}>
              ℹ️ Once deployed, find your endpoint name in: <strong>AWS Console → SageMaker → Inference → Endpoints</strong>
            </div>

            <div className="vs-setup-fields">
              <div className="vs-field">
                <label>SageMaker Endpoint Name <span style={{color:"var(--red)"}}>*</span></label>
                <input
                  placeholder="e.g. rppg-vitals-endpoint"
                  value={endpoint}
                  onChange={e=>setEndpoint(e.target.value)}
                  style={{fontFamily:"monospace"}}
                />
                <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>Enter the endpoint <em>name</em>, not the full URL.</div>
              </div>

              <div className="vs-field">
                <label>Input format sent to endpoint</label>
                <input value="video/webm binary (60-second face scan recording)" readOnly style={{background:"var(--surface)",color:"var(--text3)"}}/>
              </div>
            </div>

            <div className="vs-setup-status">
              {endpoint
                ? <div className="alert alert-success">✓ Endpoint configured: <strong>{endpoint}</strong></div>
                : <div className="alert alert-error">⚠ No endpoint set. Enter an endpoint name above to continue.</div>
              }
            </div>

            <div className="divider"/>

            <div className="vs-setup-title" style={{marginBottom:8}}>Result Forwarding (optional)</div>
            <p className="vs-setup-sub" style={{marginBottom:14}}>After the scan, the app can open your email client to send results to a patient or colleague.</p>

            <div className="vs-field" style={{maxWidth:420}}>
              <label>Forward results to</label>
              <div className="vs-contact-row">
                <select value={contact.type} onChange={e=>setContact(p=>({...p,type:e.target.value}))} style={{width:120,flexShrink:0}}>
                  <option value="email">📧 Email</option>
                  <option value="phone">📱 Phone</option>
                </select>
                <input
                  placeholder={contact.type==="email"?"patient@email.com":"+91 9999999999"}
                  value={contact.value}
                  onChange={e=>setContact(p=>({...p,value:e.target.value}))}
                />
              </div>
              <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>
                {contact.type==="email" ? "Will open your default email client with the results pre-filled." : "Phone number saved — copy to send via SMS/WhatsApp after scan."}
              </div>
            </div>

            <div className="divider"/>

            <div className="vs-setup-title" style={{marginBottom:8}}>How the rPPG Scan Works</div>
            <div className="vs-how-list">
              {[
                ["1","Camera records your face for 60 seconds at 30fps"],
                ["2","Video blob (webm/mp4) sent as binary to SageMaker endpoint"],
                ["3","Model detects subtle skin colour changes caused by blood flow (rPPG)"],
                ["4","Endpoint returns JSON with 8 vital sign estimates"],
                ["5","Results displayed and optionally forwarded to your contact"],
              ].map(([n,t])=>(
                <div className="vs-how-item" key={n}>
                  <div className="vs-how-num">{n}</div>
                  <span>{t}</span>
                </div>
              ))}
            </div>

            <button className="btn btn-primary" style={{marginTop:20}} onClick={()=>setTab("scan")} disabled={!endpoint}>
              Continue to Face Scan →
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ SCAN TAB ═══════════════ */}
      {tab === "scan" && (
        <div className="vs-scan-wrap fade-up">
          <div className="vs-scan-layout">
            {/* Main scan card */}
            <div className="card vs-scan-card">
              {phase === "idle" && (
                <div className="vs-idle">
                  <div className="vs-face-svg">
                    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                      <circle cx="40" cy="40" r="38" fill="var(--g50)" stroke="var(--g200)" strokeWidth="2"/>
                      <circle cx="28" cy="33" r="6" fill="var(--g400)"/>
                      <circle cx="52" cy="33" r="6" fill="var(--g400)"/>
                      <path d="M26 52 Q40 62 54 52" stroke="var(--g500)" strokeWidth="3" strokeLinecap="round" fill="none"/>
                    </svg>
                  </div>
                  <h2>rPPG Face Scan</h2>
                  <p>Stay still for 60 seconds while the camera captures subtle skin colour changes caused by blood flow. No contact required.</p>
                  {!endpoint && <div className="alert alert-error" style={{marginTop:8,fontSize:12}}>⚠ Set the rPPG endpoint in the <strong>Setup</strong> tab first.</div>}
                  {scanError && <div className="alert alert-error" style={{marginTop:8,fontSize:12}}>{scanError}</div>}
                  <button className="btn btn-primary vs-start-btn" onClick={startScan} disabled={!endpoint}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    Start 60-Second Scan
                  </button>
                </div>
              )}

              {phase === "scanning" && (
                <div className="vs-active">
                  <div className="vs-video-wrap">
                    <video ref={videoRef} autoPlay muted playsInline className="vs-video"/>
                    <div className="vs-overlay">
                      <div className="vs-face-guide"/>
                      <div className="vs-scanline" style={{top:`${progress}%`}}/>
                    </div>
                    <div className="vs-timer">{scanTime}s</div>
                    <div className="vs-rec">⏺ REC</div>
                  </div>
                  <div className="vs-progress-wrap">
                    <div className="vs-progress-top">
                      <span>Scanning &amp; recording…</span>
                      <span className="vs-pct">{progress}%</span>
                    </div>
                    <div className="vs-progress-bg"><div className="vs-progress-fill" style={{width:`${progress}%`}}/></div>
                    <p className="vs-hint">Keep still · Face centred · Breathe normally · Good lighting</p>
                  </div>
                  <button className="btn btn-ghost" onClick={()=>{clearInterval(timerRef.current);recorderRef.current?.stop();stopCamera();}}>Cancel</button>
                </div>
              )}

              {phase === "processing" && (
                <div className="vs-processing">
                  <div className="vs-orb">
                    {[120,90,60].map((s,i)=>(
                      <div key={i} className="vs-ring" style={{width:s,height:s,animationDelay:`${i*.35}s`}}/>
                    ))}
                    <div className="vs-orb-core">🧠</div>
                  </div>
                  <h3>Sending to rPPG Model</h3>
                  <p>Uploading video to SageMaker endpoint…</p>
                  <code style={{fontSize:11,color:"var(--text4)",wordBreak:"break-all",maxWidth:300,textAlign:"center"}}>{endpoint}</code>
                  <div className="vs-proc-steps">
                    {["Compressing frames","Sending to SageMaker","Extracting rPPG signal","Computing vital signs"].map((s,i)=>(
                      <div key={i} className="vs-proc-step">
                        <div className="vs-proc-dot" style={{animationDelay:`${i*.3}s`}}/>
                        {s}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Metrics preview */}
            <div className="vs-metrics-preview card">
              <div className="vmp-title">Metrics Measured</div>
              {METRICS.map(m=>(
                <div className="vmp-item" key={m.key} style={{"--mc":m.color}}>
                  <span>{m.icon}</span>
                  <span>{m.label}</span>
                  <span className="vmp-unit">{m.unit}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ RESULTS TAB ═══════════════ */}
      {tab === "results" && vitals && (
        <div className="fade-up">
          {/* Banner */}
          <div className="vs-result-banner">
            <span className="vs-result-banner-icon">✅</span>
            <div>
              <div className="vs-rb-title">Scan Complete — rPPG Analysis</div>
              <div className="vs-rb-sub">{new Date().toLocaleString()} · Endpoint: {endpoint}</div>
            </div>
          </div>

          {vitals._raw && (
            <div className="alert alert-error" style={{marginBottom:14}}>
              ⚠ Could not map response fields. Raw: <code style={{fontSize:10}}>{vitals._raw}</code>
            </div>
          )}

          {/* Metrics grid */}
          <div className="vs-grid">
            {METRICS.map((m,i)=>{
              const val=vitals[m.key]; const st=getStatus(m.key,val);
              return (
                <div className="vs-metric-card card fade-up" key={m.key} style={{animationDelay:`${i*.05}s`,"--mc":m.color}}>
                  <div className="vmc-top">
                    <div className="vmc-icon" style={{background:`${m.color}18`,color:m.color}}>{m.icon}</div>
                    <span className={`badge ${ST[st].cls}`}>{ST[st].label}</span>
                  </div>
                  <div className="vmc-value">{val??'—'}{val&&val!=="—"&&<span className="vmc-unit"> {m.unit}</span>}</div>
                  <div className="vmc-label">{m.label}</div>
                  {m.normal&&<div className="vmc-range">Normal: {m.normal[0]}–{m.normal[1]} {m.unit}</div>}
                  <div className="vmc-bar-bg">
                    <div className="vmc-bar" style={{
                      width:m.normal&&val!=="—"?`${Math.min(100,parseFloat(val)/(m.normal[1]*1.3)*100)}%`:"50%",
                      background:m.color
                    }}/>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Forward result card */}
          <div className="card vs-fwd-card">
            <div className="vs-fwd-title">📤 Forward Results</div>
            <div className="vs-fwd-row">
              <div className="vs-contact-row" style={{flex:1,maxWidth:460}}>
                <select value={contact.type} onChange={e=>setContact(p=>({...p,type:e.target.value}))} style={{width:120,flexShrink:0}}>
                  <option value="email">📧 Email</option>
                  <option value="phone">📱 Phone</option>
                </select>
                <input
                  placeholder={contact.type==="email"?"patient@email.com":"+91 9999999999"}
                  value={contact.value}
                  onChange={e=>setContact(p=>({...p,value:e.target.value}))}
                />
              </div>
              <button className="btn btn-primary" onClick={sendResult} disabled={!contact.value||sending||sent}>
                {sending ? <><span className="spin"/>Sending…</> : sent ? "✓ Opened" : "Send Report"}
              </button>
              <button className="btn btn-secondary" onClick={printReport}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Print
              </button>
            </div>
            {sent && contact.type==="email" && <div className="alert alert-success" style={{marginTop:10,fontSize:12}}>✓ Email client opened with pre-filled report.</div>}
            {contact.type==="phone" && contact.value && <div className="alert alert-info" style={{marginTop:10,fontSize:12}}>📱 Phone: {contact.value} — copy the printed report and send via SMS/WhatsApp.</div>}
          </div>

          <div className="card vs-summary-card">
            <div className="vs-fwd-title">🩺 Clinical Summary</div>
            <p>Results derived from a 60-second rPPG facial scan. For clinical decisions always cross-reference with physical examination. Schedule follow-up in 4 weeks for trend monitoring.</p>
          </div>
        </div>
      )}
    </div>
  );
}
