import React, { useState } from 'react';

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  return (
    <div className="card">
      <h2>Welcome</h2>
      <p>Enter an email to continue (demo sign-in).</p>
      <div className="grid" style={{gridTemplateColumns:'1fr auto', gap:'8px'}}>
        <input className="input" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} />
        <button className="btn primary" onClick={()=>onLogin({email})}>Continue</button>
      </div>
      <div className="small" style={{marginTop:8}}>Privacy: this demo stores data locally in memory.</div>
    </div>
  );
}
