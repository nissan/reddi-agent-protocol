"use client";

import { useState } from "react";
import { youtubeEmbedUrl, youtubeWatchUrl } from "../lib/videos";

// One video. YouTube's player sets cookies and sees the visitor's address, so nothing is loaded from YouTube until the
// visitor presses play; the plain link works either way and is the fallback when the player is blocked.
export default function VideoEmbed({ youtubeId, title }: { youtubeId: string; title: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="video">
      {shown ? (
        <iframe className="video-frame" src={youtubeEmbedUrl(youtubeId)} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      ) : (
        <div className="video-gate">
          <p className="video-actions">
            <button type="button" className="button" onClick={() => setShown(true)}>Play here</button>
            <a className="text-link" href={youtubeWatchUrl(youtubeId)} rel="noopener noreferrer">Watch on YouTube ↗</a>
          </p>
          <p className="small">Playing here loads the video from YouTube, which may set cookies. Nothing is loaded from YouTube until you press the button.</p>
        </div>
      )}
    </div>
  );
}
