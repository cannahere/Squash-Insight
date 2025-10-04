import React, { useEffect, useRef, useState } from 'react';

const ZONES = ['Front-Left','Front-Right','Middle','Back-Left','Back-Right'];
const SHOTS = ['Drive','Drop','Lob','Boast','Serve','Return'];

function toYouTubeEmbed(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}`;
      if (u.pathname.startsWith('/embed/')) return url;
    }
  } catch (e) {
    // ignore parse issues
  }
  return '';
}

export default function MatchDetail({ match, onUpdate, onReport }) {
  const videoRef = useRef(null);
  const [url, setUrl] = useState(match?.videoUrl || '');
  const [rallyStart, setRallyStart] = useState(0);

  // analyze state
  const [analyzing, setAnalyzing] = useState(false);
  const [hud, setHud] = useState({ motion: 0, audio: 0, idle: 0, splits: 0, msg: '' });
  const [sens, setSens] = useState(1.4); // 1.2–2.0 (lower = more sensitive)

  const intervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const lastMotionRef = useRef(0);

  // adaptive baselines (EMA)
  const mBaseRef = useRef(1); // motion baseline
  const aBaseRef = useRef(1); // audio baseline

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); const v = videoRef.current; if (!v) return; (v.paused ? v.play() : v.pause()); }
      if (e.code === 'Enter') { e.preventDefault(); manualSplit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (videoRef.current) setRallyStart(videoRef.current.currentTime || 0);
  }, [match?.id]);

  if (!match) return <div className="card">No match selected.</div>;

  const embed = toYouTubeEmbed(url);
  const isYouTube = Boolean(embed);
  const playableUrl = isYouTube ? embed : url;

  function saveUrl() { onUpdate((m) => ({ ...m, videoUrl: url })); }
  function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    setUrl(blobUrl);
    onUpdate((m) => ({ ...m, videoUrl: blobUrl }));
  }

  function pushRally(start, end) {
    const durationSec = Math.max(1, Math.round(end - start));
    const rally = { id: `r${(match?.rallies?.length || 0) + 1}`, ts: new Date().toISOString(), tStart: start, tEnd: end, durationSec };
    onUpdate((m) => ({ ...m, rallies: [ ...(m.rallies || []), rally ] }));
    setRallyStart(end);
  }

  function manualSplit() { const v = videoRef.current; if (!v) return; pushRally(rallyStart, v.currentTime); }

  function startAnalyze() {
    if (isYouTube) { setHud((h) => ({ ...h, msg: 'Auto needs an uploaded MP4 or CORS-enabled MP4. YouTube blocks analysis.' })); return; }
    const v = videoRef.current; if (!v) return;
    setAnalyzing(true);
    setHud({ motion: 0, audio: 0, idle: 0, splits: 0, msg: 'Analyzing…' });
    if (v.paused) v.play();

    // motion canvas
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth || 640;
    canvas.height = v.videoHeight || 360;
    const ctx = canvas.getContext('2d');
    let lastImage = null;

    // audio analyser
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const src = ac.createMediaElementSource(v);
      const an = ac.createAnalyser();
      an.fftSize = 512;
      const arr = new Uint8Array(an.frequencyBinCount);
      src.connect(an);
      an.connect(ac.destination);
      audioCtxRef.current = ac;
      analyserRef.current = an;
      dataArrayRef.current = arr;
    } catch (e) {
      setHud((h) => ({ ...h, msg: 'Audio blocked; motion-only mode.' }));
    }

    // reset baselines
    mBaseRef.current = 1;
    aBaseRef.current = 1;
    let lastSplit = v.currentTime || 0;
    lastMotionRef.current = performance.now();

    intervalRef.current = setInterval(() => {
      if (v.paused || v.ended) return;

      try {
        // motion score
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const cur = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let motion = 0;
        if (lastImage) {
          const a = cur.data, b = lastImage.data;
          for (let i = 0; i < a.length; i += 4 * 16) { // sample pixels
            const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            if (d > 60) motion++;
          }
        }
        lastImage = cur;

        // audio rms
        let audio = 0;
        if (analyserRef.current && dataArrayRef.current) {
          analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
          let sum = 0;
          for (let i = 0; i < dataArrayRef.current.length; i++) {
            const dv = dataArrayRef.current[i] - 128;
            sum += dv * dv;
          }
          audio = Math.sqrt(sum / dataArrayRef.current.length);
        }

        // update baselines (EMA)
        const alpha = 0.05;
        mBaseRef.current = (1 - alpha) * mBaseRef.current + alpha * Math.max(1, motion);
        aBaseRef.current = (1 - alpha) * aBaseRef.current + alpha * Math.max(1, audio);

        const motionActive = motion > mBaseRef.current * sens;
        const audioActive = audio > aBaseRef.current * sens;
        const active = motionActive || audioActive;

        const nowMs = performance.now();
        if (active) lastMotionRef.current = nowMs;
        const idleMs = nowMs - lastMotionRef.current;

        // split when quiet for 600ms and ≥1.6s since last split
        if (idleMs > 600 && (v.currentTime - lastSplit) > 1.6) {
          const start = lastSplit;
          const end = v.currentTime;
          lastSplit = end;
          pushRally(start, end);
          setHud((h) => ({ ...h, splits: h.splits + 1 }));
        }

        setHud((h) => ({
          ...h,
          motion: Math.round(motion),
          audio: Math.round(audio * 100) / 100,
          idle: Math.round(idleMs)
        }));
      } catch (e) {
        setHud((h) => ({ ...h, msg: 'CORS/pixel access blocked. Use uploaded MP4.' }));
        stopAnalyze();
      }
    }, 120);
  }

  function stopAnalyze() {
    setAnalyzing(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch (e) {} audioCtxRef.current = null; }
    setHud((h) => ({ ...h, msg: 'Stopped.' }));
  }

  function incr(group, key) {
    onUpdate((m) => ({ ...m, tallies: { ...m.tallies, [group]: { ...m.tallies[group], [key]: (m.tallies[group][key] || 0) + 1 } } }));
  }
  function decr(group, key) {
    onUpdate((m) => ({ ...m, tallies: { ...m.tallies, [group]: { ...m.tallies[group], [key]: Math.max(0, (m.tallies[group][key] || 0) - 1) } } }));
  }

  return (
    <div className="grid two">
      <div className="card">
        <h3>{match.title}</h3>

        <div className="video">
          {playableUrl ? (
            isYouTube ? (
              <iframe title="Match Video" width="100%" height="100%" src={playableUrl} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen></iframe>
            ) : (
              <video ref={videoRef} src={playableUrl} controls style={{ width: '100%', height: '100%' }} />
            )
          ) : <div className="small">Paste a YouTube link or upload an MP4 using the panel on the right.</div>}
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => { const v = videoRef.current; if (!v) return; (v.paused ? v.play() : v.pause()); }}>
            Play/Pause <span className="small">(<kbd>Space</kbd>)</span>
          </button>
          <button className="btn primary" onClick={manualSplit}>
            Manual Split <span className="small">(<kbd>Enter</kbd>)</span>
          </button>
          {!analyzing ? (
            <button className="btn green" onClick={startAnalyze}>Start Analyze (Auto)</button>
          ) : (
            <button className="btn red" onClick={stopAnalyze}>Stop Analyze</button>
          )}
        </div>

        <div className="row" style={{ marginTop: 6, alignItems: 'center' }}>
          <div className="small" style={{ minWidth: 90 }}>Sensitivity</div>
          <input type="range" min="1.2" max="2.0" step="0.05" value={sens} onChange={(e) => setSens(parseFloat(e.target.value))} />
          <div className="small">×{sens}</div>
        </div>

        <div className="hud">
          <div className="chip">Motion: {hud.motion}</div>
          <div className="chip">Audio: {hud.audio}</div>
          <div className="chip">Idle: {hud.idle}ms</div>
          <div className="chip">Splits: {hud.splits}</div>
          {hud.msg && <div className="chip">{hud.msg}</div>}
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-title">Rallies</div>
          <table className="table">
            <thead><tr><th>#</th><th>Start (s)</th><th>End (s)</th><th>Dur (s)</th></tr></thead>
            <tbody>
              {(match.rallies || []).map((r, i) => (
                <tr key={r.id}><td>{i + 1}</td><td>{Math.round(r.tStart)}</td><td>{Math.round(r.tEnd)}</td><td>{r.durationSec}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="small">Auto splits when motion/audio dip briefly. Use Manual Split anytime.</div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Video Source</div>
        <div className="row">
          <input className="input" placeholder="Paste YouTube link or direct MP4 URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn" onClick={saveUrl}>Save URL</button>
          <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={onUpload} />
        </div>

        {/* Tallies */}
        <div className="section-title" style={{ marginTop: 16 }}>Result</div>
        <div className="row">
          <CounterBtn color="green" label="Win" onInc={() => incr('result', 'Win')} onDec={() => decr('result', 'Win')} count={match.tallies.result.Win} />
          <CounterBtn color="red" label="Lose" onInc={() => incr('result', 'Lose')} onDec={() => decr('result', 'Lose')} count={match.tallies.result.Lose} />
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Reason</div>
        <div className="row">
          <CounterBtn color="green" label="Winner" onInc={() => incr('reason', 'Winner')} onDec={() => decr('reason', 'Winner')} count={match.tallies.reason.Winner} />
          <CounterBtn color="amber" label="Forced" onInc={() => incr('reason', 'Forced')} onDec={() => decr('reason', 'Forced')} count={match.tallies.reason.Forced} />
          <CounterBtn color="red" label="Unforced" onInc={() => incr('reason', 'Unforced')} onDec={() => decr('reason', 'Unforced')} count={match.tallies.reason.Unforced} />
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Serve Quality</div>
        <div className="row">
          <CounterBtn color="green" label="Good" onInc={() => incr('serve', 'Good')} onDec={() => decr('serve', 'Good')} count={match.tallies.serve.Good} />
          <CounterBtn color="gray" label="Neutral" onInc={() => incr('serve', 'Neutral')} onDec={() => decr('serve', 'Neutral')} count={match.tallies.serve.Neutral} />
          <CounterBtn color="red" label="Poor" onInc={() => incr('serve', 'Poor')} onDec={() => decr('serve', 'Poor')} count={match.tallies.serve.Poor} />
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Return Quality</div>
        <div className="row">
          <CounterBtn color="green" label="Good" onInc={() => incr('ret', 'Good')} onDec={() => decr('ret', 'Good')} count={match.tallies.ret.Good} />
          <CounterBtn color="gray" label="Neutral" onInc={() => incr('ret', 'Neutral')} onDec={() => decr('ret', 'Neutral')} count={match.tallies.ret.Neutral} />
          <CounterBtn color="red" label="Poor" onInc={() => incr('ret', 'Poor')} onDec={() => decr('ret', 'Poor')} count={match.tallies.ret.Poor} />
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Shot Type</div>
        <div className="row">
          {SHOTS.map((s) => (
            <CounterBtn key={s} color="gray" label={s} onInc={() => incr('shots', s)} onDec={() => decr('shots', s)} count={match.tallies.shots[s]} />
          ))}
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Target Zone</div>
        <div className="row">
          {ZONES.map((z) => (
            <CounterBtn key={z} color="gray" label={z} onInc={() => incr('zones', z)} onDec={() => decr('zones', z)} count={match.tallies.zones[z]} />
          ))}
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={onReport}>Open Report</button>
        </div>
      </div>
    </div>
  );
}

function CounterBtn({ color = 'gray', label, count = 0, onInc, onDec }) {
  return (
    <div
      className={'btn ' + color + ' counterbtn'}
      onClick={onInc}
      onContextMenu={(e) => { e.preventDefault(); onDec(); }}
    >
      <span>{label}</span>
      <span className="count">{count}</span>
    </div>
  );
}
