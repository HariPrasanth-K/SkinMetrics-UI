import { useState } from "react";
import "./Login.css";

export default function Login({ onLogin }) {
  const [form, setForm]     = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  const handle = e => {
    e.preventDefault();
    if (!form.email || !form.password) { setError("Please fill in all fields."); return; }
    setError(""); setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onLogin({ name: form.email.split("@")[0], email: form.email });
    }, 1100);
  };

  return (
    <div className="login-bg">
      {/* Left branding */}
      <div className="login-left">
        <div className="ll-brand">
         <span className="ll-title">Skin Analysis</span>
        </div>
        <div className="ll-headline">
          <h1> Face Scan &{" "}
            <span className="highlight">Health Report</span>
          </h1>

          <h2>Scan your Face and receive a Report instantly !
          </h2>
          
          <p className="quote">When Wealth is lost, something is lost; when Health is lost, everything is lost
          </p>
        </div>
        </div>

<div className="ll-headline"></div>

      {/* Right form */}
      <div className="login-right">
        <div className="login-card fade-up">
          <h2>Welcome back</h2>
          <p>Sign in to your health dashboard</p>

          <form onSubmit={handle} className="login-form">
            <div className="lf-group">
              <label>Email address</label>
              <div className="lf-input-wrap">
                <svg className="lf-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <input type="email" placeholder="doctor@clinic.com" value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} />
              </div>
            </div>
            <div className="lf-group">
              <label>Password</label>
              <div className="lf-input-wrap">
                <svg className="lf-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                <input type="password" placeholder="••••••••" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} />
              </div>
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <button type="submit" className="login-btn btn btn-primary" disabled={loading}>
              {loading ? <><span className="spin"/>Signing in…</> : <>Sign In <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
