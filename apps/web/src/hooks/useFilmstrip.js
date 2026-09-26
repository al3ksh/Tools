import { useEffect, useState } from 'react';

// Grabs `count` evenly spaced frames from a video URL for a RangeStrip lane.
// Each frame shows the middle of its slice of the timeline. Returns [] until
// the frames are ready (the strip shows a shimmer meanwhile) or on failure.
export default function useFilmstrip(sourceUrl, duration, count = 10) {
  const [frames, setFrames] = useState([]);

  useEffect(() => {
    setFrames([]);
    if (!sourceUrl || !duration || duration <= 0) return undefined;

    let cancelled = false;
    const made = [];
    const video = document.createElement('video');
    video.src = sourceUrl;
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const waitFor = (event) => new Promise((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('Could not read video frames')); };
      const cleanup = () => {
        video.removeEventListener(event, done);
        video.removeEventListener('error', fail);
      };
      video.addEventListener(event, done, { once: true });
      video.addEventListener('error', fail, { once: true });
    });

    (async () => {
      try {
        if (video.readyState < 1) await waitFor('loadedmetadata');
        const canvas = document.createElement('canvas');
        const ratio = video.videoWidth / Math.max(video.videoHeight, 1);
        canvas.height = 96;
        canvas.width = Math.max(96, Math.round(canvas.height * Math.min(Math.max(ratio, 0.5), 2.4)));
        const ctx = canvas.getContext('2d');
        for (let i = 0; i < count && !cancelled; i++) {
          video.currentTime = Math.min((duration * (i + 0.5)) / count, Math.max(duration - 0.05, 0));
          await waitFor('seeked');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
          if (blob) made.push({ t: video.currentTime, url: URL.createObjectURL(blob) });
        }
        if (!cancelled) setFrames([...made]);
      } catch {
        if (!cancelled) setFrames([]);
      }
    })();

    return () => {
      cancelled = true;
      video.removeAttribute('src');
      video.load();
      made.forEach((frame) => URL.revokeObjectURL(frame.url));
    };
  }, [sourceUrl, duration, count]);

  return frames;
}
