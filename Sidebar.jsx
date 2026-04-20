import "./Sidebar.css";

const NAV = [
  {
    id: "skin",
    label: "Skin Analysis",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
      </svg>
    ),
  },
  {
    id: "vitals",
    label: "Health Report",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
];

export default function Sidebar({ activePage, setActivePage, user, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="sb-logo">
        <div className="sb-logo-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div>
          <div className="sb-logo-title">Skin Analysis</div>
          <div className="sb-logo-sub">Face Scan Report</div>
        </div>
      </div>

      <div className="sb-section">MENU</div>

      <nav className="sb-nav">
        {NAV.map(item => (
          <button
            key={item.id}
            className={`sb-item ${activePage === item.id ? "active" : ""}`}
            onClick={() => setActivePage(item.id)}
          >
            <span className="sb-icon">{item.icon}</span>
            <span>{item.label}</span>
            {activePage === item.id && <span className="sb-active-bar" />}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      <div className="sb-user">
        <div className="sb-avatar">{user?.name?.[0]?.toUpperCase() || "U"}</div>
        <div className="sb-user-info">
          <div className="sb-user-name">{user?.name}</div>
          <div className="sb-user-role">Log Out</div>
        </div>
        <button className="sb-logout" onClick={onLogout} title="Sign out">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </aside>
  );
}
