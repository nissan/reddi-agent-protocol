"use client";

import { useState } from "react";
import { X_HANDLE, X_URL } from "../lib/copy";

// The @reddiagent timeline. X's embed script sets cookies and sees the visitor's address, so nothing from X is loaded
// until the visitor presses the button; the plain link works either way and is the fallback when the embed is blocked.
export default function XFeed() {
  const [shown, setShown] = useState(false);
  function load() {
    setShown(true);
    if (document.getElementById("x-widgets")) { (window as unknown as { twttr?: { widgets?: { load: () => void } } }).twttr?.widgets?.load(); return; }
    const s = document.createElement("script");
    s.id = "x-widgets"; s.async = true; s.src = "https://platform.twitter.com/widgets.js";
    document.body.appendChild(s);
  }
  return (
    <div className="xfeed">
      {shown ? (
        <div className="xfeed-frame">
          <a className="twitter-timeline" data-height="560" data-theme="light" data-dnt="true" data-chrome="noheader nofooter" href="https://twitter.com/reddiagent">Posts by {X_HANDLE}</a>
          <p className="small">Nothing showing? X sometimes hides timelines from signed-out visitors. <a className="text-link" href={X_URL} rel="noopener noreferrer">Open {X_HANDLE} on X ↗</a></p>
        </div>
      ) : (
        <div className="xfeed-gate">
          <p className="xfeed-handle">{X_HANDLE}</p>
          <p>Build notes, short demos and launch news, as they happen.</p>
          <p className="xfeed-actions">
            <button type="button" className="button" onClick={load}>Show latest posts here</button>
            <a className="text-link" href={X_URL} rel="noopener noreferrer">Follow on X ↗</a>
          </p>
          <p className="small">Showing posts here loads content from X, which may set cookies. Nothing is loaded from X until you press the button.</p>
        </div>
      )}
    </div>
  );
}
