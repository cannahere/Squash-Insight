import React, { useMemo, useState } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import MatchesPage from './pages/MatchesPage';
import MatchDetail from './pages/MatchDetail';
import ReportPage from './pages/ReportPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';

export default function App() {
  const [user, setUser] = useState(null);
  const [matches, setMatches] = useState([
    { id: 'm1', title: "Practice Match 1", date: new Date().toISOString().slice(0,10), opponent: 'TBD', format: 'Bo5', videoUrl: '', notes: '', rallies: [] }
  ]);
  const [selectedMatchId, setSelectedMatchId] = useState('m1');

  const navigate = useNavigate();
  const currentMatch = useMemo(() => matches.find(m => m.id === selectedMatchId), [matches, selectedMatchId]);

  const addMatch = () => {
    const id = `m${matches.length + 1}`;
    const m = { id, title: `Practice Match ${matches.length + 1}`, date: new Date().toISOString().slice(0,10), opponent: 'TBD', format: 'Bo5', videoUrl: '', notes: '', rallies: [] };
    setMatches([m, ...matches]);
    setSelectedMatchId(id);
    navigate('/match/' + id);
  };

  const updateMatch = (id, updater) => {
    setMatches(prev => prev.map(m => m.id === id ? { ...m, ...updater(m) } : m));
  };

  return (
    <div className="container">
      <header className="header">
        <div className="brand">
          <div className="logo"></div>
          <strong>Squash Insight</strong>
        </div>
        <nav className="nav">
          <Link to="/">Matches</Link>
          <Link to={currentMatch ? `/match/${currentMatch.id}` : '/'}>Detail</Link>
          <Link to={currentMatch ? `/report/${currentMatch.id}` : '/'}>Report</Link>
          <Link to="/settings">Settings</Link>
          {user ? <span className="badge">{user.email}</span> : <Link to="/login">Login</Link>}
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<MatchesPage matches={matches} onAdd={addMatch} onOpen={(id)=>{setSelectedMatchId(id); navigate('/match/'+id);}} />} />
        <Route path="/login" element={<LoginPage onLogin={(u)=>{setUser(u); navigate('/');}} />} />
        <Route path="/match/:id" element={<MatchDetail match={currentMatch} onUpdate={(updater)=>updateMatch(currentMatch.id, updater)} onReport={()=>navigate('/report/'+currentMatch.id)} />} />
        <Route path="/report/:id" element={<ReportPage match={currentMatch} />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>

      <div className="footer">MVP Prototype • Paste URL or Upload MP4</div>
    </div>
  );
}
