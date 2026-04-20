import { useState } from "react";
import Login from "./pages/Login";
import SkinAnalysis from "./pages/SkinAnalysis";
import VitalSigns from "./pages/VitalSigns";
import Sidebar from "./components/Sidebar";
import "./App.css";

export default function App() {
  const [user, setUser] = useState(null);
  const [activePage, setActivePage] = useState("skin");

  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} setActivePage={setActivePage} user={user} onLogout={() => setUser(null)} />
      <main className="app-main">
        {activePage === "skin" && <SkinAnalysis />}
        {activePage === "vitals" && <VitalSigns />}
      </main>
    </div>
  );
}
