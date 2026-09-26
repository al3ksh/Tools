import { useEffect, useState } from 'react';
import { Volume, Volume1, Volume2, VolumeX } from 'lucide-react';

const STORAGE_KEY = 'previewVolume';
const DEFAULT_VOLUME = 0.6;

function readStored() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Number.isFinite(saved.volume)) {
      return { volume: Math.min(1, Math.max(0, saved.volume)), muted: !!saved.muted };
    }
  } catch { /* first run or bad value */ }
  return { volume: DEFAULT_VOLUME, muted: false };
}

// For players without their own control: use the level the trimmers set.
export function applyStoredVolume(media) {
  if (!media) return;
  const { volume, muted } = readStored();
  media.volume = volume;
  media.muted = muted;
}

// Preview volume for a media element. One level is shared by every trimmer
// and remembered, so previews never start at full blast.
export default function VolumeControl({ mediaRef }) {
  const [state, setState] = useState(readStored);
  const { volume, muted } = state;

  useEffect(() => {
    const media = mediaRef.current;
    if (media) {
      media.volume = volume;
      media.muted = muted;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [mediaRef, state, volume, muted]);

  const silent = muted || volume === 0;
  const Icon = silent ? VolumeX : volume < 0.34 ? Volume : volume < 0.67 ? Volume1 : Volume2;
  const shown = silent ? 0 : volume;

  return (
    <div className="volume-control">
      <button
        type="button"
        className="volume-toggle"
        onClick={() => setState((s) => (s.volume === 0 ? { volume: DEFAULT_VOLUME, muted: false } : { ...s, muted: !s.muted }))}
        aria-label={silent ? 'Unmute preview' : 'Mute preview'}
        title={silent ? 'Unmute' : 'Mute'}
      >
        <Icon size={15} />
      </button>
      <input
        type="range"
        className="volume-slider"
        min="0"
        max="1"
        step="0.01"
        value={shown}
        onChange={(e) => setState({ volume: Number(e.target.value), muted: false })}
        aria-label="Preview volume"
        title={`Volume ${Math.round(shown * 100)}%`}
        style={{ '--fill': `${shown * 100}%` }}
      />
    </div>
  );
}
