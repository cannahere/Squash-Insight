import React, { useState } from 'react';

const courtZones = ['Front-Left','Front-Right','Back-Left','Back-Right','Middle'];
const shotTypes = ['Drive','Boast','Drop','Lob','Serve','Return'];

export default function MatchDetail({ match, onUpdate, onReport }) {
  const [isRallyActive, setIsRallyActive] = useState(false);
  const [rallyStart, setRallyStart] = useState(null);

  const [form, setForm] = useState({
    result: 'Win',
    reason: 'Winner',
    serveQuality: 'Neutral',
    returnQuality: 'Neutral',
    shotType: 'Drive',
    targetZone: 'Back-Right'
  });

  const startRally = () => {
    if (isRallyActive) return;
    setRallyStart(Date.now());
    setIsRallyActive(true);
  };

  const endRally = () => {
    if (!isRallyActive) return;
    const durationSec = Math.max(1, Math.round((Date.now() - rallyStart)/1000));
    const rally = {
      id: `r${(match?.rallies?.length || 0) + 1}`,
      ts: new Date().toISOString(),
      durationSec,
      ...form
    };
    onUpdate(m => ({ ...m, rallies: [...(m.rallies || []), rally] }));
    setIsRallyActive(false);
    setRallyStart(null);
  };

  const removeLast = () => {
    if (!match?.rallies?.length) return;
    onUpdate(m => ({ ...m, rallies: m.rallies.slice(0, m.rallies.length - 1) }));
  };

  if (!match) return <div className="card">No match selected.</div>;

  return (
    <div className="grid two">
      <div className="card">
        <h3>{match.title}</h3>
        <div className="video">
          <iframe title="Match Video" width="100%" height="100%" src={match.videoUrl} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen></iframe>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Rally Tagger</div>
        <div className="toolbar">
          <button className="btn" onClick={startRally} disabled={isRallyActive}>Start Rally</button>
          <button className="btn" onClick={endRally} disabled={!isRallyActive}>End Rally</button>
          <button className="btn" onClick={removeLast} disabled={!match.rallies?.length}>Remove Last</button>
          <button className="btn primary" onClick={onReport}>Generate Report</button>
        </div>

        <div className="grid two" style={{marginTop:12}}>
          <div>
            <label>Result</label><br/>
            <select value={form.result} onChange={e=>setForm({...form, result:e.target.value})}>
              <option>Win</option><option>Lose</option>
            </select>
          </div>
          <div>
            <label>Reason</label><br/>
            <select value={form.reason} onChange={e=>setForm({...form, reason:e.target.value})}>
              <option>Winner</option><option>Forced</option><option>Unforced</option>
            </select>
          </div>
          <div>
            <label>Serve quality</label><br/>
            <select value={form.serveQuality} onChange={e=>setForm({...form, serveQuality:e.target.value})}>
              <option>Good</option><option>Neutral</option><option>Poor</option>
            </select>
          </div>
          <div>
            <label>Return quality</label><br/>
            <select value={form.returnQuality} onChange={e=>setForm({...form, returnQuality:e.target.value})}>
              <option>Good</option><option>Neutral</option><option>Poor</option>
            </select>
          </div>
          <div>
            <label>Shot type</label><br/>
            <select value={form.shotType} onChange={e=>setForm({...form, shotType:e.target.value})}>
              {shotTypes.map(s=> <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label>Target zone</label><br/>
            <select value={form.targetZone} onChange={e=>setForm({...form, targetZone:e.target.value})}>
              {courtZones.map(z=> <option key={z}>{z}</option>)}
            </select>
          </div>
        </div>

        <div className="hint" style={{marginTop:10}}>Tip: Start Rally, wait a few seconds, End Rally, then set outcome details. Tag ~8 rallies to see trends.</div>
      </div>
    </div>
  );
}
