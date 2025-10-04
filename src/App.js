import React, { useMemo, useState } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import MatchesPage from './pages/MatchesPage';
import MatchDetail from './pages/MatchDetail';
import ReportPage from './pages/ReportPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import './styles.css';

export default function App() {
  const [user, setUser] = useState(null);

  // Initial match with proper tallies (this is the “last line” idea, baked in)
  const [matches, setMatches] = useState([
    createMatch('Practice Match 1')
  ]);

  const [selectedMatchId, setSelectedMatchId] = useState(matches[0].id);
  const navigate = useNavigate();
  const currentMatch = useMemo(
    () => matches.find(m => m.id === selectedMatchId),
    [matches, selectedMatchId]
  );

  function addMatch() {
    const m = createMatch(`Practice Match ${matches.length + 1}`);
    setMatches([m, ...matches]);
    setSelectedMatchId(m.id);
    navigate('/match/' + m.id);
  }

  function updateMatch(id, updater) {
    setMatches(prev => prev.map(m => m.id === id ? { ...m, ...updater(m) } : m));
  }

  return (
    <div className="container">
      <header className="header">
        <div className="brand">
          <div className="logo" />
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
        <Route
          path="/"
          element={
            <MatchesPage
              matches={matches}
              onAdd={addMatch}
              onOpen={(id) => { setSelectedMatchId(id); navigate('/match/' + id); }}
            />
          }
        />
        <Route path="/login" element={<LoginPage onLogin={(u) => { setUser(u); navigate('/'); }} />} />
        <Route
          path="/match/:id"
          element={
            <MatchDetail
              match={currentMatch}
              onUpdate={(updater) => updateMatch(currentMatch.id, updater)}
              onReport={() => navigate('/report/' + currentMatch.id)}
            />
          }
        />
        <Route path="/report/:id" element={<ReportPage match={currentMatch} />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>

      <div className="footer">
        MVP • Start/Stop Analyze (auto-split rallies) • Space=Play/Pause, Enter=Manual Split
      </div>
    </div>
  );
}

/** ------- Helpers ------- **/

function createMatch(title) {
  return {
    id: String(Date.now() + Math.random()),
    title,
    date: new Date().toISOString().slice(0, 10),
    opponent: 'TBD',
    format: 'Bo5',
    videoUrl: '',
    notes: '',
    rallies: [],
    tallies: initTallies()
  };
}

function initTallies() {
  return {
    result: { Win: 0, Lose: 0 },
    reason: { Winner: 0, Forced: 0, Unforced: 0 },
    serve: { Good: 0, Neutral: 0, Poor: 0 },
    ret: { Good: 0, Neutral: 0, Poor: 0 },
    shots: { Drive: 0, Drop: 0, Lob: 0, Boast: 0, Serve: 0, Return: 0 },
    zones: {
      'Front-Left': 0,
      'Front-Right': 0,
      Middle: 0,
      'Back-Left': 0,
      'Back-Right': 0
    }
  };
}
