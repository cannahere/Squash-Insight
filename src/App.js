import React, { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: 40 }}>
      <h1>Squash Insight MVP</h1>
      <p>Clickable prototype demo. Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Add Point</button>
    </div>
  );
}
