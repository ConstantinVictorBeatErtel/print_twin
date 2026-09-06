import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import './styles.css';

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {convex ? <ConvexProvider client={convex}>
      <App />
    </ConvexProvider> : <main className="capture-entry"><div className="capture-card">
      <p className="capture-kicker">doodleforge</p><h1>Connect your workspace.</h1>
      <p className="capture-copy">Start the Convex development backend, then reload this page.</p>
      <code>npx convex dev</code>
    </div></main>}
  </React.StrictMode>,
);
