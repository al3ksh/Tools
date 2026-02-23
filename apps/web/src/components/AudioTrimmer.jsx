import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import { Play, Pause, Scissors, ZoomIn, ZoomOut } from 'lucide-react';

export default function AudioTrimmer({ file, onChange, initialStart, initialEnd }) {
    const containerRef = useRef(null);
    const timelineRef = useRef(null);
    const wavesurferRef = useRef(null);
    const regionsRef = useRef(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [zoom, setZoom] = useState(0);

    useEffect(() => {
        if (!containerRef.current || !file) return;

        const ws = WaveSurfer.create({
            container: containerRef.current,
            waveColor: 'rgba(255, 255, 255, 0.4)',
            progressColor: 'var(--accent)',
            cursorColor: 'var(--text-primary)',
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
            height: 100,
            normalize: true,
            plugins: [
                TimelinePlugin.create({
                    container: timelineRef.current
                })
            ]
        });

        const regions = ws.registerPlugin(RegionsPlugin.create());
        regionsRef.current = regions;
        wavesurferRef.current = ws;

        ws.on('ready', () => {
            const dur = ws.getDuration();
            setDuration(dur);

            // Clear all regions and create a new one
            regions.clearRegions();
            regions.addRegion({
                start: initialStart !== undefined && initialStart !== '' ? parseFloat(initialStart) : 0,
                end: initialEnd !== undefined && initialEnd !== '' ? parseFloat(initialEnd) : dur,
                color: 'rgba(92, 106, 227, 0.3)', // matching var(--accent) slightly transparent
                drag: true,
                resize: true,
            });
            if (zoom > 0) {
                ws.zoom(zoom * 20);
            }
        });

        ws.on('play', () => setIsPlaying(true));
        ws.on('pause', () => setIsPlaying(false));

        regions.on('region-updated', (region) => {
            // Round to 3 decimal places to avoid overly long floats
            onChange({
                start: Number(Math.max(0, region.start).toFixed(3)),
                end: Number(Math.min(duration || Infinity, region.end).toFixed(3))
            });
        });

        const url = URL.createObjectURL(file);
        ws.load(url);

        return () => {
            URL.revokeObjectURL(url);
            ws.destroy();
        };
    }, [file]); // only re-run when file changes completely

    const handlePlayPause = () => {
        wavesurferRef.current?.playPause();
    };

    const handleZoomIn = () => {
        const newZoom = zoom + 1;
        setZoom(newZoom);
        wavesurferRef.current?.zoom(newZoom === 0 ? 0 : newZoom * 20);
    };

    const handleZoomOut = () => {
        const newZoom = Math.max(0, zoom - 1);
        setZoom(newZoom);
        wavesurferRef.current?.zoom(newZoom === 0 ? 0 : newZoom * 20);
    };

    const formatTime = (seconds) => {
        if (isNaN(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    return (
        <div className="audio-trimmer" style={{ padding: '15px', marginBottom: '20px', border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--bg-card)', width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
                <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Scissors size={18} /> Visual Trimmer
                </h4>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleZoomOut} title="Zoom Out">
                        <ZoomOut size={16} />
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleZoomIn} title="Zoom In">
                        <ZoomIn size={16} />
                    </button>
                </div>
            </div>

            <div ref={timelineRef} style={{ width: '100%', marginBottom: '10px', fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden' }} />
            <div ref={containerRef} style={{ width: '100%', backgroundColor: 'var(--bg-input)', borderRadius: '4px', overflow: 'hidden' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '15px' }}>
                <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: 'auto', display: 'flex', gap: '5px' }}
                    onClick={handlePlayPause}
                >
                    {isPlaying ? <Pause size={18} /> : <Play size={18} />} {isPlaying ? 'Pause' : 'Play'}
                </button>

                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                    Total Duration: {formatTime(duration)}
                </span>
            </div>
        </div>
    );
}
