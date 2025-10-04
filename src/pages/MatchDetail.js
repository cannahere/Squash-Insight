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

/** ---------- Heuristic helpers (no ML) ---------- **/
function computeSuggestions(feats) {
  // feats = { dur, peaks, maxAudio, avgMotion }
  const { dur = 0, peaks = 0, maxAudio = 0 } = feats || {};

  // RESULT (your perspective)
  let result = 'Win';
  if (dur <= 3 && peaks <= 2) result = 'Lose';
  else if (maxAudio < 7 && peaks < 3) result = 'Lose';

  // REASON
  let reason = 'Winner';
  if (dur <= 3 && peaks <= 2) reason = 'Unforced';
  else if (maxAudio >= 10 || (peaks >= 3 && dur <= 6)) reason = 'Forced';

  // SHOT (very rough)
  let shot = 'Drive';
  if (dur <= 3 && peaks <= 2) shot = 'Drop';

  // Quality suggestions (serve/return)
  // Longer, active rallies -> better quality; very short -> poor
  let quality = 'Neutral';
  if (dur > 8 && peaks >= 3) quality = 'Good';
  if (dur <= 3 && peaks <= 2) quality = 'Poor';

  return { result, reason, shot, quality };
}

function Chip({ color='gray', onClick, children }) {
  return <div className={`btn ${color}`} onClick={onClick} style={{userSelect:'none'}}>{children}</div>;
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
  const mBaseRef = useRef(1);
  const aBaseRef = useRef(1);

  // per-rally feature accumulation
  const curPeaksRef = useRef(0);
  const lastActiveRef = useRef(false);
  const maxAudioRef = useRef(0);
  const motionSumRef = useRef(0);
  const framesRef = useRef(0);

  // Player names & server (persist in match)
  const playerYou = match?.playerYou ?? 'Daniel';
  const playerOpp = match?.playerOpp ?? 'Opponent';
  const server = match?.server ?? 'you'; // 'you' | 'opp' — who served THIS rally

  // Quick-Tag overlay state
  const [quickTag, setQuickTag] = useState({
    open: false,
    server: server, // snapshot for the just-ended rally
    suggest: { result:'Win', reason:'Winner', shot:'Drive', serveQ:'Neutral', returnQ:'Neutral' },
    lastRallyId: null
  });

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); const v = videoRef.current; if (!v) return; (v.paused ? v.play() : v.pause()); }
      if (e.code === 'Enter') { e.preventDefault(); manualSplit(); }
      if (quickTag.open) {
        if (e.key === '1') applyResult('Win');
        if (e.key === '2') applyResult('Lose');
        if (e.key === '3') applyReason('Winner');
        if (e.key === '4') applyReason('Forced');
        if (e.key === '5') applyReason('Unforced');
        if (e.key === '6') applyShot('Drive');
        if (e.key === '7') applyShot('Drop');
        if (e.key === '8') toggleServer(); // quick toggle server
        if (e.key === '0') acceptAllSuggestions();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quickTag]);

  useEffect(() => {
    if (videoRef.current) setRallyStart(videoRef.current.currentTime || 0);
  }, [match?.id]);

  if (!match) return <div className="card">No match selected.</div>;

  const embed = toYouTubeEmbed(url);
  const isYouTube = Boolean(embed);
  const playableUrl = isYouTube ? embed : url;

  /** ---------- Top: Player config ---------- **/
  function savePlayers(yourName, oppName) {
    onUpdate((m) => ({ ...m, playerYou: yourName || 'You', playerOpp: oppName || 'Opponent' }));
  }
  function setServer(val) {
    onUpdate((m) => ({ ...m, server: val === 'you' ? 'you' : 'opp' }));
  }

  /** ---------- Video source ---------- **/
  function saveUrl() { onUpdate((m) => ({ ...m, videoUrl: url })); }
  function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    setUrl(blobUrl);
    onUpdate((m) => ({ ...m, videoUrl: blobUrl }));
  }

  /** ---------- Rally creation ---------- **/
  function pushRally(start, end, feats) {
    const durationSec = Math.max(1, Math.round(end - start));
    const rally = {
      id: `r${(match?.rallies?.length || 0) + 1}`,
      ts: new Date().toISOString(),
      tStart: start,
      tEnd: end,
      durationSec,
      serverAtStart: match?.server ?? 'you', // who served THIS rally
      feats
    };
    onUpdate((m) => ({ ...m, rallies: [ ...(m.rallies || []), rally ] }));

    // Prepare Quick-Tag with suggestions
    const sug = computeSuggestions({ dur: durationSec, ...feats });
    const suggest = {
      result: sug.result,
      reason: sug.reason,
      shot: sug.shot,
      serveQ: sug.quality,
      returnQ: sug.quality
    };
    setQuickTag({ open: true, server: rally.serverAtStart, suggest, lastRallyId: rally.id });

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

  /** ---------- Analyzer loop ---------- **/
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

  /** ---------- Counters (right panel) ---------- **/
  function incr(group, key) {
    onUpdate((m) => ({ ...m, tallies: { ...m.tallies, [group]: { ...m.tallies[group], [key]: (m.tallies[group][key] || 0) + 1 } } }));
  }
  function decr(group, key) {
    onUpdate((m) => ({ ...m, tallies: { ...m.tallies, [group]: { ...m.tallies[group], [key]: Math.max(0, (m.tallies[group][key] || 0) - 1) } } }));
  }

  /** ---------- Quick-Tag actions ---------- **/
  function applyResult(val) {
    // update counters and next server per squash rule (winner serves next)
    if (val === 'Win') { incr('result', 'Win'); setServer('you'); }
    else { incr('result', 'Lose'); setServer('opp'); }
    setQuickTag((q) => ({ ...q, suggest: { ...q.suggest, result: val } }));
  }
  function applyReason(val) { incr('reason', val); setQuickTag((q) => ({ ...q, suggest: { ...q.suggest, reason: val } })); }
  function applyShot(val) { incr('shots', val); setQuickTag((q) => ({ ...q, suggest: { ...q.suggest, shot: val } })); }
  function applyServeQuality(val) { incr('serve', val); setQuickTag((q) => ({ ...q, suggest: { ...q.suggest, serveQ: val } })); }
  function applyReturnQuality(val) { incr('ret', val); setQuickTag((q) => ({ ...q, suggest: { ...q.suggest, returnQ: val } })); }

  function toggleServer() {
    setQuickTag((q) => ({ ...q, server: q.server === 'you' ? 'opp' : 'you' }));
  }

  function acceptAllSuggestions() {
    const s = quickTag.suggest;
    // result & next server
    applyResult(s.result);
    // reason & shot
    incr('reason', s.reason);
    incr('shots', s.shot);
    // serve/return counted based on who served THIS rally
    if (quickTag.server === 'you') {
      incr('serve', s.serveQ);
    } else {
      incr('ret', s.returnQ);
    }
    setQuickTag(q => ({ ...q, open: false }));
  }

  /** ---------- Render ---------- **/
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
            <Chip color={server==='you'?'green':'gray'} onClick={()=>setServer('you')}>{playerYou}</Chip>
            <Chip color={server==='opp'?'red':'gray'} onClick={()=>setServer('opp')}>{playerOpp}</Chip>
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
            <thead><tr><th>#</th><th>Start (s)</th><th>End (s)</th><th>Dur (s)</th><th>Server</th></tr></thead>
            <tbody>
              {(match.rallies || []).map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>{Math.round(r.tStart)}</td>
                  <td>{Math.round(r.tEnd)}</td>
                  <td>{r.durationSec}</td>
                  <td>{r.serverAtStart === 'you' ? playerYou : playerOpp}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small">Auto splits when motion/audio dip briefly. Use Manual Split anytime.</div>
        </div>
      </div>

      {/* Right: Tag counters */}
      <div className="card">
        <div className="section-title">Video Source</div>
        <div className="row">
          <input className="input" placeholder="Paste YouTube link or direct MP4 URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn" onClick={saveUrl}>Save URL</button>
          <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={onUpload} />
        </div>

        <div className="section-title" style={{ marginTop: 16 }}>Result</div>
        <div className="row">
          <Chip color="green" onClick={() => incr('result','Win')}>Win {match.tallies.result.Win}</Chip>
          <Chip color="red" onClick={() => incr('result','Lose')}>Lose {match.tallies.result.Lose}</Chip>
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Reason</div>
        <div className="row">
          <Chip color="green" onClick={() => incr('reason','Winner')}>Winner {match.tallies.reason.Winner}</Chip>
          <Chip color="amber" onClick={() => incr('reason','Forced')}>Forced {match.tallies.reason.Forced}</Chip>
          <Chip color="red" onClick={() => incr('reason','Unforced')}>Unforced {match.tallies.reason.Unforced}</Chip>
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Serve Quality (when YOU served)</div>
        <div className="row">
          <Chip color="green" onClick={() => incr('serve','Good')}>Good {match.tallies.serve.Good}</Chip>
          <Chip color="gray"  onClick={() => incr('serve','Neutral')}>Neutral {match.tallies.serve.Neutral}</Chip>
          <Chip color="red"   onClick={() => incr('serve','Poor')}>Poor {match.tallies.serve.Poor}</Chip>
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Return Quality (when OPP served)</div>
        <div className="row">
          <Chip color="green" onClick={() => incr('ret','Good')}>Good {match.tallies.ret.Good}</Chip>
          <Chip color="gray"  onClick={() => incr('ret','Neutral')}>Neutral {match.tallies.ret.Neutral}</Chip>
          <Chip color="red"   onClick={() => incr('ret','Poor')}>Poor {match.tallies.ret.Poor}</Chip>
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Shot Type</div>
        <div className="row">
          {SHOTS.map((s) => (
            <Chip key={s} color="gray" onClick={() => incr('shots', s)}>{s} {match.tallies.shots[s]}</Chip>
          ))}
        </div>

        <div className="section-title" style={{ marginTop: 12 }}>Target Zone</div>
        <div className="row">
          {ZONES.map((z) => (
            <Chip key={z} color="gray" onClick={() => incr('zones', z)}>{z} {match.tallies.zones[z]}</Chip>
          ))}
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={onReport}>Open Report</button>
        </div>
      </div>

      {/* Quick-Tag overlay */}
      {quickTag.open && (
        <div
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50 }}
          onClick={()=>setQuickTag(q=>({...q, open:false}))}
        >
          <div className="card" style={{width:620}} onClick={e=>e.stopPropagation()}>
            <div className="section-title">Quick-Tag (press <kbd>0</kbd> = Accept All, <kbd>8</kbd> = Toggle Server)</div>
            <div className="small" style={{marginBottom:8}}>
              Suggestions use rally duration, activity bursts, and audio spikes. Adjust if needed.
            </div>

            {/* Server selector for this rally */}
            <div style={{marginBottom:8}}>
              <div className="small">Server for this rally</div>
              <div className="row">
                <Chip color={quickTag.server==='you'?'green':'gray'} onClick={()=>setQuickTag(q=>({...q, server:'you'}))}>{playerYou}</Chip>
                <Chip color={quickTag.server==='opp'?'red':'gray'} onClick={()=>setQuickTag(q=>({...q, server:'opp'}))}>{playerOpp}</Chip>
              </div>
            </div>

            {/* Result */}
            <div>
              <div className="small">Result (your perspective) — 1=Win, 2=Lose</div>
              <div className="row">
                <Chip color="green" onClick={()=>applyResult('Win')}>Win {quickTag.suggest.result==='Win' ? '•' : ''}</Chip>
                <Chip color="red" onClick={()=>applyResult('Lose')}>Lose {quickTag.suggest.result==='Lose' ? '•' : ''}</Chip>
              </div>
            </div>

            {/* Reason */}
            <div style={{marginTop:8}}>
              <div className="small">Reason — 3=Winner, 4=Forced, 5=Unforced</div>
              <div className="row">
                <Chip color="green" onClick={()=>applyReason('Winner')}>Winner {quickTag.suggest.reason==='Winner' ? '•' : ''}</Chip>
                <Chip color="amber" onClick={()=>applyReason('Forced')}>Forced {quickTag.suggest.reason==='Forced' ? '•' : ''}</Chip>
                <Chip color="red" onClick={()=>applyReason('Unforced')}>Unforced {quickTag.suggest.reason==='Unforced' ? '•' : ''}</Chip>
              </div>
            </div>

            {/* Serve / Return Quality */}
            <div style={{marginTop:8}}>
              <div className="small">Quality (auto-suggested)</div>
              <div className="row">
                <Chip color="green" onClick={()=>applyServeQuality('Good')}>Serve Good {quickTag.suggest.serveQ==='Good' ? '•' : ''}</Chip>
                <Chip color="gray"  onClick={()=>applyServeQuality('Neutral')}>Serve Neutral {quickTag.suggest.serveQ==='Neutral' ? '•' : ''}</Chip>
                <Chip color="red"   onClick={()=>applyServeQuality('Poor')}>Serve Poor {quickTag.suggest.serveQ==='Poor' ? '•' : ''}</Chip>
              </div>
              <div className="row" style={{marginTop:6}}>
                <Chip color="green" onClick={()=>applyReturnQuality('Good')}>Return Good {quickTag.suggest.returnQ==='Good' ? '•' : ''}</Chip>
                <Chip color="gray"  onClick={()=>applyReturnQuality('Neutral')}>Return Neutral {quickTag.suggest.returnQ==='Neutral' ? '•' : ''}</Chip>
                <Chip color="red"   onClick={()=>applyReturnQuality('Poor')}>Return Poor {quickTag.suggest.returnQ==='Poor' ? '•' : ''}</Chip>
              </div>
              <div className="small" style={{marginTop:4}}>
                Tip: Count <strong>Serve Quality</strong> if <em>you</em> served this rally; count <strong>Return Quality</strong> if the <em>opponent</em> served.
              </div>
            </div>

            {/* Shot */}
            <div style={{marginTop:8}}>
              <div className="small">Shot Type — 6=Drive, 7=Drop</div>
              <div className="row">
                {SHOTS.map(s=>(
                  <Chip key={s} color="gray" onClick={()=>applyShot(s)}>
                    {s} {quickTag.suggest.shot===s ? '•' : ''}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="row" style={{marginTop:10}}>
              <button className="btn green" onClick={acceptAllSuggestions}>Accept All</button>
              <button className="btn" onClick={()=>setQuickTag(q=>({...q, open:false}))}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
