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
  } catch (e) {}
  return '';
}

/** ---------------- Heuristics (no ML) ---------------- **/
function autoTagFromFeatures({ dur=0, peaks=0, maxAudio=0, avgMotion=0 }, serverAtStart='you') {
  // Result (your perspective)
  let result = 'Win';
  if (dur <= 3 && peaks <= 2) result = 'Lose';
  else if (maxAudio < 7 && peaks < 3) result = 'Lose';

  // Reason
  let reason = 'Winner';
  if (dur <= 3 && peaks <= 2) reason = 'Unforced';
  else if (maxAudio >= 10 || (peaks >= 3 && dur <= 6)) reason = 'Forced';

  // Serve / Return quality (based on rally length & activity)
  let quality = 'Neutral';
  if (dur > 8 && peaks >= 3) quality = 'Good';
  if (dur <= 3 && peaks <= 2) quality = 'Poor';
  const serveQ  = serverAtStart === 'you' ? quality : undefined;
  const returnQ = serverAtStart === 'opp' ? quality : undefined;

  // Shot type (very rough)
  let shot = 'Drive';
  if (dur <= 3 && peaks <= 2) shot = 'Drop';

  // Zone (placeholder heuristic tied to duration/activity)
  let zone = 'Middle';
  if (dur > 8) zone = 'Back-Right';
  else if (dur <= 3) zone = 'Front-Left';

  return { result, reason, serveQ, returnQ, shot, zone };
}

export default function MatchDetail({ match, onUpdate, onReport }) {
  const videoRef = useRef(null);
  const [url, setUrl] = useState(match?.videoUrl || '');
  const [rallyStart, setRallyStart] = useState(0);

  // analyze state
  const [analyzing, setAnalyzing] = useState(false);
  const [hud, setHud] = useState({ motion: 0, audio: 0, idle: 0, splits: 0, msg: '' });
  const [sens, setSens] = useState(1.4); // 1.2–2.0 (lower = more sensitive)
  const [showLog, setShowLog] = useState(false);

  const intervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const lastMotionRef = useRef(0);

  // adaptive baselines (EMA)
  const mBaseRef = useRef(1);
  const aBaseRef = useRef(1);

  // per-rally feature accumulation
  const curPeaksRef = useRef(0);
  const lastActiveRef = useRef(false);
  const maxAudioRef = useRef(0);
  const motionSumRef = useRef(0);
  const framesRef = useRef(0);

  // Player names & server (persisted in match)
  const playerYou = match?.playerYou ?? 'Daniel';
  const playerOpp = match?.playerOpp ?? 'Opponent';
  const server = match?.server ?? 'you'; // who serves the NEXT rally by default

  // Live log (optional)
  const [log, setLog] = useState([]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
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

  /** --------------- Top: Player config --------------- **/
  function savePlayers(yourName, oppName) {
    onUpdate((m) => ({ ...m, playerYou: yourName || 'You', playerOpp: oppName || 'Opponent' }));
  }
  function setServer(val) {
    onUpdate((m) => ({ ...m, server: val === 'you' ? 'you' : 'opp' }));
  }

  /** --------------- Video source --------------- **/
  function saveUrl() { onUpdate((m) => ({ ...m, videoUrl: url })); }
  function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    setUrl(blobUrl);
    onUpdate((m) => ({ ...m, videoUrl: blobUrl }));
  }

  /** --------------- Rally handling --------------- **/
  function pushRally(start, end, feats) {
    const durationSec = Math.max(1, Math.round(end - start));
    const serverAtStart = match?.server ?? 'you';

    const tags = autoTagFromFeatures({ dur: durationSec, ...feats }, serverAtStart);

    // Batch update: add rally, increment tallies, set next server (winner serves next)
    onUpdate((m) => {
      const t = { ...m.tallies };

      // Result
      if (tags.result === 'Win') t.result = { ...t.result, Win: (t.result.Win || 0) + 1 };
      else                      t.result = { ...t.result, Lose: (t.result.Lose || 0) + 1 };

      // Reason
      t.reason = { ...t.reason, [tags.reason]: (t.reason[tags.reason] || 0) + 1 };

      // Serve/Return quality (only one counts per rally depending on server)
      if (serverAtStart === 'you' && tags.serveQ) {
        t.serve = { ...t.serve, [tags.serveQ]: (t.serve[tags.serveQ] || 0) + 1 };
      }
      if (serverAtStart === 'opp' && tags.returnQ) {
        t.ret = { ...t.ret, [tags.returnQ]: (t.ret[tags.returnQ] || 0) + 1 };
      }

      // Shot
      t.shots = { ...t.shots, [tags.shot]: (t.shots[tags.shot] || 0) + 1 };

      // Zone
      t.zones = { ...t.zones, [tags.zone]: (t.zones[tags.zone] || 0) + 1 };

      const rally = {
        id: `r${(m?.rallies?.length || 0) + 1}`,
        ts: new Date().toISOString(),
        tStart: start,
        tEnd: end,
        durationSec,
        serverAtStart,
        autoTags: tags
      };

      const nextServer = tags.result === 'Win' ? 'you' : 'opp'; // winner serves next (your perspective)

      return {
        ...m,
        rallies: [ ...(m.rallies || []), rally ],
        tallies: t,
        server: nextServer
      };
    });

    // Log line (optional)
    setLog((prev) => {
      const line = `Rally ${(match?.rallies?.length || 0) + 1}: ${tags.result} • ${tags.reason} • ${serverAtStart === 'you' ? 'Serve ' : 'Return '}${serverAtStart === 'you' ? tags.serveQ : tags.returnQ} • ${tags.shot} • ${tags.zone}`;
      const arr = [line, ...prev];
      return arr.slice(0, 12);
    });

    setRallyStart(end);
  }

  function manualSplit() {
    const v = videoRef.current; if (!v) return;
    const now = v.currentTime;
    const feats = {
      peaks: curPeaksRef.current,
      maxAudio: maxAudioRef.current,
      avgMotion: framesRef.current ? motionSumRef.current / framesRef.current : 0
    };
    resetFeatAccumulators();
    pushRally(rallyStart, now, feats);
  }

  /** --------------- Analyzer loop --------------- **/
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
      src.connect(an); an.connect(ac.destination);
      audioCtxRef.current = ac; analyserRef.current = an; dataArrayRef.current = arr;
    } catch (e) {
      setHud((h) => ({ ...h, msg: 'Audio blocked; motion-only mode.' }));
    }

    // reset baselines & features
    mBaseRef.current = 1; aBaseRef.current = 1;
    resetFeatAccumulators();

    let lastSplit = v.currentTime || 0;
    lastMotionRef.current = performance.now();

    intervalRef.current = setInterval(() => {
      if (v.paused || v.ended) return;

      try {
        // motion
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const cur = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let motion = 0;
        if (lastImage) {
          const a = cur.data, b = lastImage.data;
          for (let i = 0; i < a.length; i += 4 * 16) {
            const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            if (d > 60) motion++;
          }
        }
        lastImage = cur;

        // audio RMS
        let audio = 0;
        if (analyserRef.current && dataArrayRef.current) {
          analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
          let sum = 0; for (let i = 0; i < dataArrayRef.current.length; i++) { const dv = dataArrayRef.current[i] - 128; sum += dv * dv; }
          audio = Math.sqrt(sum / dataArrayRef.current.length);
        }

        // EMA baselines
        const alpha = 0.05;
        mBaseRef.current = (1 - alpha) * mBaseRef.current + alpha * Math.max(1, motion);
        aBaseRef.current = (1 - alpha) * aBaseRef.current + alpha * Math.max(1, audio);

        const active = (motion > mBaseRef.current * sens) || (audio > aBaseRef.current * sens);

        // feature accumulation
        motionSumRef.current += motion;
        framesRef.current += 1;
        if (audio > maxAudioRef.current) maxAudioRef.current = audio;
        if (active && !lastActiveRef.current) curPeaksRef.current += 1;
        lastActiveRef.current = active;

        // idle detection -> split
        const nowMs = performance.now();
        if (active) lastMotionRef.current = nowMs;
        const idleMs = nowMs - lastMotionRef.current;

        if (idleMs > 600 && (v.currentTime - lastSplit) > 1.6) {
          const start = lastSplit; const end = v.currentTime; lastSplit = end;
          const feats = {
            peaks: curPeaksRef.current,
            maxAudio: maxAudioRef.current,
            avgMotion: framesRef.current ? motionSumRef.current / framesRef.current : 0
          };
          resetFeatAccumulators();
          pushRally(start, end, feats);
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

  function resetFeatAccumulators() {
    curPeaksRef.current = 0;
    lastActiveRef.current = false;
    maxAudioRef.current = 0;
    motionSumRef.current = 0;
    framesRef.current = 0;
  }

  /** ---------------- Render ---------------- **/
  return (
    <div className="grid two">
      {/* Left: Video + controls */}
      <div className="card">
        {/* Player config row */}
        <div className="row" style={{alignItems:'center', marginBottom:8}}>
          <span className="small">You:</span>
          <input
            className="input"
            style={{maxWidth:160}}
            defaultValue={playerYou}
            onBlur={(e)=>savePlayers(e.target.value, playerOpp)}
          />
          <span className="small">Opponent:</span>
          <input
            className="input"
            style={{maxWidth:160}}
            defaultValue={playerOpp}
            onBlur={(e)=>savePlayers(playerYou, e.target.value)}
          />
          <span className="small">Server now:</span>
          <div className="row" style={{gap:6}}>
            <div className={`btn ${server==='you'?'green':'gray'}`} onClick={()=>setServer('you')}>{playerYou}</div>
            <div className={`btn ${server==='opp'?'red':'gray'}`} onClick={()=>setServer('opp')}>{playerOpp}</div>
          </div>
        </div>

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
          <label className="small" style={{marginLeft:10}}>
            <input type="checkbox" checked={showLog} onChange={e=>setShowLog(e.target.checked)} /> Show live log
          </label>
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
            <thead><tr><th>#</th><th>Start (s)</th><th>End (s)</th><th>Dur (s)</th><th>Server</th><th>Auto Tags</th></tr></thead>
            <tbody>
              {(match.rallies || []).map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>{Math.round(r.tStart)}</td>
                  <td>{Math.round(r.tEnd)}</td>
                  <td>{r.durationSec}</td>
                  <td>{r.serverAtStart === 'you' ? playerYou : playerOpp}</td>
                  <td className="small">
                    {r.autoTags
                      ? `${r.autoTags.result}, ${r.autoTags.reason}, ${r.serverAtStart==='you' ? 'Serve' : 'Return'} ${r.serverAtStart==='you' ? r.autoTags.serveQ : r.autoTags.returnQ}, ${r.autoTags.shot}, ${r.autoTags.zone}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {showLog && (
            <div className="small" style={{marginTop:8}}>
              <strong>Live log</strong>
              <ul style={{marginTop:6}}>
                {log.map((l,idx)=>(<li key={idx}>{l}</li>))}
              </ul>
            </div>
          )}
          <div className="small">Auto splits & auto-tags run while analyzing. Manual Split works anytime.</div>
        </div>
      </div>

      {/* Right: Auto-updating counters (read-only) */}
      <div className="card">
        <div className="section-title">Video Source</div>
        <div className="row">
          <input className="input" placeholder="Paste YouTube link or direct MP4 URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn" onClick={saveUrl}>Save URL</button>
          <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={onUpload} />
        </div>

        <div className="section-title" style={{ marginTop: 16 }}>Result</div>
        <div className="row">
          <div className="btn green">Win {match.tallies.result.Win}</div>
          <div className="btn red">Lose {match.tallies.result.Lose}</div>
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Reason</div>
        <div className="row">
          <div className="btn green">Winner {match.tallies.reason.Winner}</div>
          <div className="btn amber">Forced {match.tallies.reason.Forced}</div>
          <div className="btn red">Unforced {match.tallies.reason.Unforced}</div>
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Serve Quality (when {playerYou} served)</div>
        <div className="row">
          <div className="btn green">Good {match.tallies.serve.Good}</div>
          <div className="btn gray">Neutral {match.tallies.serve.Neutral}</div>
          <div className="btn red">Poor {match.tallies.serve.Poor}</div>
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Return Quality (when {playerOpp} served)</div>
        <div className="row">
          <div className="btn green">Good {match.tallies.ret.Good}</div>
          <div className="btn gray">Neutral {match.tallies.ret.Neutral}</div>
          <div className="btn red">Poor {match.tallies.ret.Poor}</div>
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Shot Type</div>
        <div className="row">
          {SHOTS.map((s) => (
            <div key={s} className="btn gray">{s} {match.tallies.shots[s]}</div>
          ))}
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Target Zone</div>
        <div className="row">
          {ZONES.map((z) => (
            <div key={z} className="btn gray">{z} {match.tallies.zones[z]}</div>
          ))}
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={onReport}>Open Report</button>
        </div>
      </div>
    </div>
  );
}
