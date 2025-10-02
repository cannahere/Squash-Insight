import React, { useEffect, useMemo, useRef, useState } from 'react';

const courtZones = ['Front-Left','Front-Right','Middle','Back-Left','Back-Right'];
const shotTypes = ['Drive','Drop','Lob','Boast','Serve','Return'];

function toYouTubeEmbed(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    }
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}`;
      if (u.pathname.startsWith('/embed/')) return url;
    }
  } catch {}
  return '';
}

export default function MatchDetail({ match, onUpdate, onReport }) {
  const videoRef = useRef(null);
  const [localVideoUrl, setLocalVideoUrl] = useState(match?.videoUrl || '');
  const [isPlaying, setIsPlaying] = useState(false);
  const [rallyStartTime, setRallyStartTime] = useState(0);
  const [analyzeActive, setAnalyzeActive] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState('');
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const lastMotionRef = useRef(0);

  useEffect(()=>{ // keyboard shortcuts
    const onKey = (e)=>{
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'Enter') { e.preventDefault(); endRally(); }
      if (e.key === 'w' || e.key === 'W') incr('result','Win');
      if (e.key === 'l' || e.key === 'L') incr('result','Lose');
      if (e.key === '1') incr('reason','Winner');
      if (e.key === '2') incr('reason','Forced');
      if (e.key === '3') incr('reason','Unforced');
    };
    window.addEventListener('keydown', onKey);
    return ()=>window.removeEventListener('keydown', onKey);
  }, [match]);

  useEffect(()=>{
    if (videoRef.current) setRallyStartTime(videoRef.current.currentTime || 0);
  }, [match?.id]);

  if (!match) return <div className="card">No match selected.</div>;

  const embed = toYouTubeEmbed(localVideoUrl);
  const isYouTube = Boolean(embed);
  const playableUrl = isYouTube ? embed : localVideoUrl;

  function togglePlay(){
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(True); } else { v.pause(); setIsPlaying(false); }
  }

  function saveVideoUrl(){
    onUpdate(m => ({ ...m, videoUrl: localVideoUrl }));
  }

  function onUpload(e){
    const file = e.target.files?.[0];
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    setLocalVideoUrl(blobUrl);
    onUpdate(m => ({ ...m, videoUrl: blobUrl }));
  }

  function endRally(){
    const v = videoRef.current;
    const now = v ? v.currentTime : 0;
    const durationSec = Math.max(1, Math.round(now - rallyStartTime));
    const rally = {
      id: `r${(match?.rallies?.length || 0) + 1}`,
      ts: new Date().toISOString(),
      tStart: rallyStartTime,
      tEnd: now,
      durationSec
    };
    onUpdate(m => ({ ...m, rallies: [...(m.rallies || []), rally] }));
    setRallyStartTime(now);
  }

  function incr(group, key){
    onUpdate(m => ({ ...m, tallies: { ...m.tallies, [group]: { ...m.tallies[group], [key]: (m.tallies[group][key]||0)+1 } } }));
  }
  function decr(group, key){
    onUpdate(m => ({ ...m, tallies: { ...m.tallies, [group]: { ...m.tallies[group], [key]: Math.max(0,(m.tallies[group][key]||0)-1) } } }));
  }

  function startAnalyze(){
    if (isYouTube) {
      setAnalyzeMsg('Auto-detect needs an uploaded MP4 or a direct MP4 URL with CORS. YouTube blocks pixel/audio access.');
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    setAnalyzeActive(true);
    setAnalyzeMsg('Analyzing… watching motion and audio to auto-split rallies. Press Stop to end.');
    // setup canvas for motion
    const canvas = canvasRef.current || (canvasRef.current = document.createElement('canvas'));
    canvas.width = v.videoWidth || 640; canvas.height = v.videoHeight || 360;
    const ctx = canvas.getContext('2d');
    let lastImageData = null;

    // setup audio
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaElementSource(v);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      dataArrayRef.current = dataArray;
    } catch (e) {
      setAnalyzeMsg('Audio analysis unavailable (browser blocked or CORS). Motion-only mode.');
    }

    let lastSplit = v.currentTime;
    lastMotionRef.current = performance.now();

    intervalRef.current = setInterval(()=>{
      if (v.paused || v.ended) return;
      try {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0,0,canvas.width,canvas.height);
        let motionScore = 0;
        if (lastImageData) {
          const a = img.data, b = lastImageData.data;
          for (let i=0; i<a.length; i+=4*16){ // sample 1/16 pixels
            const d = Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]);
            if (d>60) motionScore++;
          }
        }
        lastImageData = img;

        let audioRMS = 0;
        if (analyserRef.current && dataArrayRef.current) {
          analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
          let sum=0;
          for (let i=0;i<dataArrayRef.current.length;i++){
            const v=dataArrayRef.current[i]-128; sum += v*v;
          }
          audioRMS = Math.sqrt(sum/dataArrayRef.current.length);
        }

        const active = motionScore>300 || audioRMS>8; // tuned heuristics
        const nowMs = performance.now();

        if (active){ lastMotionRef.current = nowMs; }
        const idleMs = nowMs - lastMotionRef.current;

        // if idle for > 800ms and at least 2s since last split -> split rally
        if (idleMs>800 && (v.currentTime - lastSplit) > 2){
          const start = lastSplit;
          const end = v.currentTime;
          lastSplit = end;
          const durationSec = Math.max(1, Math.round(end - start));
          const rally = { id: `r${(match?.rallies?.length || 0) + 1}`, ts:new Date().toISOString(), tStart:start, tEnd:end, durationSec };
          onUpdate(m => ({ ...m, rallies: [...(m.rallies || []), rally] }));
          setRallyStartTime(end);
        }
      } catch(e){
        setAnalyzeMsg('Video not readable for analysis (CORS). Use uploaded MP4 or CORS-enabled URL.');
        stopAnalyze();
      }
    }, 160); // ~6 fps
  }

  function stopAnalyze(){
    setAnalyzeActive(false);
    if (intervalRef.current){ clearInterval(intervalRef.current); intervalRef.current=null; }
    if (audioCtxRef.current){ try{ audioCtxRef.current.close(); }catch(e){} audioCtxRef.current=null; }
    setAnalyzeMsg('Stopped.');
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
              <video ref={videoRef} src={playableUrl} controls style={{width:'100%', height:'100%'}} />
            )
          ) : (
            <div className="small">Paste a YouTube link or upload an MP4 using the panel on the right.</div>
          )}
        </div>
        <div className="row" style={{marginTop:8}}>
          <button className="btn" onClick={()=>{const v=videoRef.current; if (!v) return; if (v.paused){v.play(); setIsPlaying(true);} else {v.pause(); setIsPlaying(false);} }}>Play/Pause <span className="small">(<kbd>Space</kbd>)</span></button>
          <button className="btn primary" onClick={()=>{ const v=videoRef.current; if (v && v.paused) v.play(); endRally(); }}>Manual Split <span className="small">(<kbd>Enter</kbd>)</span></button>
          {!analyzeActive ? (
            <button className="btn green" onClick={startAnalyze}>Start Analyze (Auto)</button>
          ) : (
            <button className="btn red" onClick={stopAnalyze}>Stop Analyze</button>
          )}
        </div>
        {analyzeMsg && <div className="warn" style={{marginTop:8}}>{analyzeMsg}</div>}

        <div className="card" style={{marginTop:12}}>
          <div className="section-title">Rallies</div>
          <table className="table">
            <thead><tr><th>#</th><th>Start (s)</th><th>End (s)</th><th>Dur (s)</th></tr></thead>
            <tbody>
              {(match.rallies||[]).map((r,i)=>(
                <tr key={r.id}><td>{i+1}</td><td>{Math.round(r.tStart)}</td><td>{Math.round(r.tEnd)}</td><td>{r.durationSec}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="small">Auto mode splits when motion+audio go quiet briefly. Use Manual Split anytime.</div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Video Source</div>
        <div className="row">
          <input className="input" placeholder="Paste YouTube link or direct MP4 URL" value={localVideoUrl} onChange={e=>setLocalVideoUrl(e.target.value)} />
          <button className="btn" onClick={saveVideoUrl}>Save URL</button>
          <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={onUpload} />
        </div>

        <div className="section-title" style={{marginTop:16}}>Result</div>
        <div className="row">
          <CounterButton color="green" label="Win" onInc={()=>incr('result','Win')} onDec={()=>decr('result','Win')} count={match.tallies.result.Win} />
          <CounterButton color="red" label="Lose" onInc={()=>incr('result','Lose')} onDec={()=>decr('result','Lose')} count={match.tallies.result.Lose} />
        </div>

        <div className="section-title" style={{marginTop:12}}>Reason</div>
        <div className="row">
          <CounterButton color="green" label="Winner" onInc={()=>incr('reason','Winner')} onDec={()=>decr('reason','Winner')} count={match.tallies.reason.Winner} />
          <CounterButton color="amber" label="Forced" onInc={()=>incr('reason','Forced')} onDec={()=>decr('reason','Forced')} count={match.tallies.reason.Forced} />
          <CounterButton color="red" label="Unforced" onInc={()=>incr('reason','Unforced')} onDec={()=>decr('reason','Unforced')} count={match.tallies.reason.Unforced} />
        </div>

        <div className="section-title" style={{marginTop:12}}>Serve Quality</div>
        <div className="row">
          <CounterButton color="green" label="Good" onInc={()=>incr('serve','Good')} onDec={()=>decr('serve','Good')} count={match.tallies.serve.Good} />
          <CounterButton color="gray" label="Neutral" onInc={()=>incr('serve','Neutral')} onDec={()=>decr('serve','Neutral')} count={match.tallies.serve.Neutral} />
          <CounterButton color="red" label="Poor" onInc={()=>incr('serve','Poor')} onDec={()=>decr('serve','Poor')} count={match.tallies.serve.Poor} />
        </div>

        <div className="section-title" style={{marginTop:12}}>Return Quality</div>
        <div className="row">
          <CounterButton color="green" label="Good" onInc={()=>incr('ret','Good')} onDec={()=>decr('ret','Good')} count={match.tallies.ret.Good} />
          <CounterButton color="gray" label="Neutral" onInc={()=>incr('ret','Neutral')} onDec={()=>decr('ret','Neutral')} count={match.tallies.ret.Neutral} />
          <CounterButton color="red" label="Poor" onInc={()=>incr('ret','Poor')} onDec={()=>decr('ret','Poor')} count={match.tallies.ret.Poor} />
        </div>

        <div className="section-title" style={{marginTop:12}}>Shot Type</div>
        <div className="row">
          {['Drive','Drop','Lob','Boast','Serve','Return'].map(s=>(
            <CounterButton key={s} color="gray" label={s} onInc={()=>incr('shots',s)} onDec={()=>decr('shots',s)} count={match.tallies.shots[s]} />
          ))}
        </div>

        <div className="section-title" style={{marginTop:12}}>Target Zone</div>
        <div className="row">
          {['Front-Left','Front-Right','Middle','Back-Left','Back-Right'].map(z=>(
            <CounterButton key={z} color="gray" label={z} onInc={()=>incr('zones',z)} onDec={()=>decr('zones',z)} count={match.tallies.zones[z]} />
          ))}
        </div>

        <div className="row" style={{marginTop:16}}>
          <button className="btn primary" onClick={onReport}>Open Report</button>
        </div>

        <div className="small" style={{marginTop:10}}>
          Tips: <kbd>Space</kbd> play/pause • <kbd>Enter</kbd> manual split • Start/Stop Analyze for auto splits (needs uploaded/CORS MP4).
        </div>
      </div>
    </div>
  );
}

function CounterButton({color='gray', label, count=0, onInc, onDec}){
  return (
    <div className={"btn "+color+" counterbtn"} onClick={onInc} onContextMenu={(e)=>{e.preventDefault(); onDec();}}>
      <span>{label}</span>
      <span className="count">{count}</span>
    </div>
  );
}