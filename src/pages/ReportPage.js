import React, { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts';

export default function ReportPage({ match }) {
  const stats = useMemo(() => {
    const rallies = match?.rallies || [];
    const total = rallies.length;
    const wins = match?.tallies?.result?.Win || 0;
    const losses = match?.tallies?.result?.Lose || 0;

    const buckets = { '0–3':0, '4–7':0, '8+':0 };
    rallies.forEach(r => {
      if (r.durationSec <= 3) buckets['0–3']++;
      else if (r.durationSec <= 7) buckets['4–7']++;
      else buckets['8+']++;
    });

    const unforced = match?.tallies?.reason?.Unforced || 0;
    const consistency = (wins+losses) ? Math.round((unforced/(wins+losses))*100) : 0;

    const poorServePct = (wins+losses) ? Math.round(((match?.tallies?.serve?.Poor || 0)/(wins+losses))*100) : 0;
    const poorReturnPct = (wins+losses) ? Math.round(((match?.tallies?.ret?.Poor || 0)/(wins+losses))*100) : 0;

    const chosen = 'Drive';
    const shotAttempts = match?.tallies?.shots?.[chosen] || 0;
    // heuristic: assume 55%+ is target (proxy success rate uses wins ratio overall for now)
    const overallSuccess = (wins+losses) ? Math.round((wins/(wins+losses))*100) : 0;
    const shotAccuracy = shotAttempts ? overallSuccess : 0;

    return { total, wins, losses, buckets, consistency, poorServePct, poorReturnPct, chosen, shotAccuracy, rallies };
  }, [match]);

  const recommendations = useMemo(() => {
    const recs = [];
    if (stats.consistency > 25) recs.push(['Cut unforced errors','Your unforced-error rate is above benchmark. Add 10-min accuracy drill (straight drives to deep targets).']);
    const shortLosses = stats.rallies.filter(r => r.durationSec <= 3).length - stats.buckets['0–3']; // rough proxy
    if ((stats.buckets['0–3'] || 0) >= Math.ceil((stats.total||0)*0.3)) recs.push(['First-two-shots focus','You are dropping early points. Practice deep returns and serve consistency.']);
    if (stats.poorServePct > 30 || stats.poorReturnPct > 30) recs.push(['Upgrade serve & return','>30% rated Poor. Do 3x10 serves to targets; returns: volley to length & cross-court depth.']);
    if (stats.shotAccuracy && stats.shotAccuracy < 55) recs.push([`${stats.chosen} accuracy below target`, 'Reps to back corners; aim behind service box with 80% pace.']);
    return recs.slice(0,3);
  }, [stats]);

  if (!match) return <div className="card">No match selected.</div>;

  return (
    <div className="grid">
      <div className="grid three">
        <KPI label="Rallies" value={stats.total} />
        <KPI label="Wins" value={stats.wins} />
        <KPI label="Consistency (UF/100)" value={stats.consistency} />
      </div>

      <div className="card">
        <div className="section-title">Rally Length Distribution</div>
        <div style={{height:260}}>
          <ResponsiveContainer width="100%" height="100%"> 
            <BarChart data={[{name:'0–3', v:stats.buckets['0–3']},{name:'4–7', v:stats.buckets['4–7']},{name:'8+', v:stats.buckets['8+']}]}>
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="v" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Point Outcomes</div>
        <div style={{height:260}}>
          <ResponsiveContainer width="100%" height="100%"> 
            <PieChart>
              <Pie dataKey="value" data={[{name:'Win', value:stats.wins},{name:'Lose', value:stats.losses}]} outerRadius={100} label>
                {[stats.wins, stats.losses].map((_,i)=>(<Cell key={i} />))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Shot Accuracy: {stats.chosen}</div>
        <div style={{display:'flex', alignItems:'center', gap:16}}>
          <KPI label="Accuracy %" value={stats.shotAccuracy} />
          <div className="small">Proxy for MVP. Per-shot outcomes come next.</div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Recommendations</div>
        {recommendations.length ? recommendations.map(([title,detail],i)=>(
          <div key={i} className="card" style={{padding:'10px', marginBottom:'8px', borderColor:'#bff3ef', background:'#eefcfb'}}>
            <strong>{title}</strong>
            <div className="small">{detail}</div>
          </div>
        )) : <div className="small">Tag a few more rallies to unlock tailored tips.</div>}
      </div>
    </div>
  );
}

function KPI({label, value}) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
