import React from 'react';

export default function MatchesPage({ matches, onAdd, onOpen }) {
  return (
    <div className="grid">
      <div className="card">
        <div className="section-title">Your Matches</div>
        <button className="btn primary" onClick={onAdd}>+ New Match</button>
      </div>

      <div className="grid two">
        {matches.map(m => (
          <div key={m.id} className="card" onClick={()=>onOpen(m.id)} style={{cursor:'pointer'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <strong>{m.title}</strong>
              <span className="badge">{m.format}</span>
            </div>
            <div className="small">{m.date} • vs {m.opponent}</div>
            <div className="small">Rallies tagged: {m.rallies?.length || 0}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
