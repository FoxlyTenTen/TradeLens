"use client";

/**
 * ScreenSharePanel Component
 * 
 * A compact sidebar widget for Screen AI. 
 * specific functionalities:
 * - Real-time Voice Chat (Mic)
 * - Screen Sharing
 * - Audio Playback from Agent
 * - NO Transcription UI
 */

import React, { useState, useRef, useCallback, useEffect } from "react";

const SCREEN_WS_URL =
    process.env.NEXT_PUBLIC_SCREEN_WS_URL || "ws://localhost:9055";

export function ScreenSharePanel() {
    const [isConnected, setIsConnected] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [isMicOn, setIsMicOn] = useState(false);
    const [status, setStatus] = useState("Idle");
    const [agentSpeaking, setAgentSpeaking] = useState(false);

    // Refs
    const wsRef = useRef<WebSocket | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const screenVideoRef = useRef<HTMLVideoElement>(null);
    const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const micCtxRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const playbackCtxRef = useRef<AudioContext | null>(null);
    const audioQueueRef = useRef<{ data: string }[]>([]);
    const isPlayingRef = useRef(false);
    const audioBufferRef = useRef<Int16Array[]>([]);
    const lastSendRef = useRef(0);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopAll();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---------- Audio playback ----------
    const playNextAudio = useCallback(async () => {
        if (audioQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            setAgentSpeaking(false);
            return;
        }
        isPlayingRef.current = true;
        setAgentSpeaking(true);
        const item = audioQueueRef.current.shift()!;

        try {
            if (!playbackCtxRef.current) {
                playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
            }
            const ctx = playbackCtxRef.current;
            if (ctx.state === "suspended") await ctx.resume();

            const bytes = Uint8Array.from(atob(item.data), (c) => c.charCodeAt(0));
            const int16 = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) {
                float32[i] = int16[i] / (int16[i] < 0 ? 32768 : 32767);
            }

            const buf = ctx.createBuffer(1, float32.length, 24000);
            buf.getChannelData(0).set(float32);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            src.onended = () => playNextAudio();
            src.start(0);
        } catch (err) {
            console.error("[ScreenPanel] Audio playback error:", err);
            playNextAudio();
        }
    }, []);

    // ---------- WebSocket ----------
    const connect = useCallback((): Promise<boolean> => {
        return new Promise((resolve) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                resolve(true);
                return;
            }

            const userId = `user_${Date.now()}`;
            const ws = new WebSocket(`${SCREEN_WS_URL}/ws/${userId}`);

            const timeout = setTimeout(() => {
                setStatus("Timeout");
                resolve(false);
            }, 10000);

            ws.onopen = () => {
                wsRef.current = ws;
                setIsConnected(true);
                setStatus("Connecting...");
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    switch (data.type) {
                        case "session_started":
                            setStatus("Active");
                            clearTimeout(timeout);
                            resolve(true);
                            break;
                        case "session_resumed":
                            setStatus("Active");
                            setIsConnected(true);
                            break;
                        case "audio":
                            audioQueueRef.current.push(data);
                            if (!isPlayingRef.current) playNextAudio();
                            break;
                        case "error":
                            setStatus("Error");
                            break;
                    }
                } catch (e) {
                    console.error("[ScreenPanel] Message parse error:", e);
                }
            };

            ws.onclose = () => {
                setIsConnected(false);
                setIsSharing(false);
                setIsMicOn(false);
                setStatus("Idle");
                wsRef.current = null;
                clearTimeout(timeout);
            };

            ws.onerror = () => {
                setStatus("Error");
                clearTimeout(timeout);
                resolve(false);
            };
        });
    }, [playNextAudio]);

    // ---------- Screen Share ----------
    const sendFrame = useCallback(() => {
        const video = screenVideoRef.current;
        const ws = wsRef.current;
        if (!video || !ws || ws.readyState !== WebSocket.OPEN) return;
        if (video.videoWidth === 0) return;

        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 768;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, 1024, 768);

        const ar = video.videoWidth / video.videoHeight;
        const targetAr = 1024 / 768;
        let dw = 1024, dh = 768, ox = 0, oy = 0;
        if (ar > targetAr) { dh = 1024 / ar; oy = (768 - dh) / 2; }
        else { dw = 768 * ar; ox = (1024 - dw) / 2; }
        ctx.drawImage(video, ox, oy, dw, dh);

        canvas.toBlob((blob) => {
            if (!blob) return;
            const reader = new FileReader();
            reader.onloadend = () => {
                const b64 = (reader.result as string).split(",")[1];
                ws.send(JSON.stringify({ type: "screen_frame", data: b64 }));
            };
            reader.readAsDataURL(blob);
        }, "image/jpeg", 0.7);
    }, []);

    const startScreenShare = useCallback(async () => {
        const ok = await connect();
        if (!ok) return;

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
            });
            screenStreamRef.current = stream;
            if (screenVideoRef.current) {
                screenVideoRef.current.srcObject = stream;
            }
            setIsSharing(true);
            setStatus("Sharing");

            setTimeout(() => sendFrame(), 500);
            frameIntervalRef.current = setInterval(sendFrame, 2000);

            stream.getVideoTracks()[0].addEventListener("ended", () => {
                stopScreenShare();
            });
        } catch {
            setStatus("Cancelled");
        }
    }, [connect, sendFrame]);

    const stopScreenShare = useCallback(() => {
        if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
        if (screenStreamRef.current) { screenStreamRef.current.getTracks().forEach((t) => t.stop()); screenStreamRef.current = null; }
        if (screenVideoRef.current) { screenVideoRef.current.srcObject = null; }
        setIsSharing(false);
        setStatus(wsRef.current?.readyState === WebSocket.OPEN ? "Active" : "Idle");
    }, []);

    // ---------- Mic ----------
    const startMic = useCallback(async () => {
        const ok = await connect();
        if (!ok) return;

        if (!playbackCtxRef.current) {
            playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
            micStreamRef.current = stream;

            const audioCtx = new AudioContext({ sampleRate: 16000 });
            micCtxRef.current = audioCtx;
            const source = audioCtx.createMediaStreamSource(stream);
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            audioBufferRef.current = [];
            lastSendRef.current = Date.now();

            processor.onaudioprocess = (e) => {
                const ws = wsRef.current;
                if (!ws || ws.readyState !== WebSocket.OPEN) return;

                const input = e.inputBuffer.getChannelData(0);
                const pcm16 = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) {
                    const s = Math.max(-1, Math.min(1, input[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                }

                audioBufferRef.current.push(pcm16);

                const now = Date.now();
                if (now - lastSendRef.current >= 500 && audioBufferRef.current.length > 0) {
                    const total = audioBufferRef.current.reduce((s, b) => s + b.length, 0);
                    const combined = new Int16Array(total);
                    let off = 0;
                    for (const buf of audioBufferRef.current) { combined.set(buf, off); off += buf.length; }
                    ws.send(combined.buffer);
                    audioBufferRef.current = [];
                    lastSendRef.current = now;
                }
            };

            source.connect(processor);
            processor.connect(audioCtx.destination);

            setIsMicOn(true);
            setStatus(isSharing ? "Sharing + Mic" : "Listening");
        } catch {
            setStatus("Mic denied");
        }
    }, [connect, isSharing]);

    const stopMic = useCallback(() => {
        if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
        if (micCtxRef.current) { micCtxRef.current.close(); micCtxRef.current = null; }
        if (micStreamRef.current) { micStreamRef.current.getTracks().forEach((t) => t.stop()); micStreamRef.current = null; }
        audioBufferRef.current = [];
        setIsMicOn(false);
        setStatus(isSharing ? "Sharing" : wsRef.current?.readyState === WebSocket.OPEN ? "Active" : "Idle");
    }, [isSharing]);

    // ---------- Stop All ----------
    const stopAll = useCallback(() => {
        stopScreenShare();
        stopMic();
        if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
        audioQueueRef.current = [];
        isPlayingRef.current = false;
        setIsConnected(false);
        setStatus("Idle");
    }, [stopScreenShare, stopMic]);

    // ---------- Render ----------
    const isError = status === "Error" || status === "Timeout" || status === "Mic denied";
    const statusColor = isError ? "#ef4444" : status === "Idle" || status === "Cancelled" ? "#94a3b8" : "#22c55e";

    return (
        <div className="flex flex-col gap-2 p-3 bg-white/50 rounded-xl border border-white/40 shadow-sm mx-2 mb-2">
            <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-[#57575B] uppercase tracking-wider">Screen AI</span>
                <div className="flex items-center gap-1.5">
                    <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                            backgroundColor: statusColor,
                            boxShadow: status === "Active" || isSharing || isMicOn ? `0 0 4px ${statusColor}` : "none",
                            animation: agentSpeaking ? "pulse 1.5s infinite" : "none"
                        }}
                    />
                    <span className="text-[10px] text-[#57575B] opacity-80 truncate max-w-[80px]">{status}</span>
                </div>
            </div>

            <div className="flex gap-2">
                <button
                    onClick={isSharing ? stopScreenShare : startScreenShare}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-medium transition-all ${isSharing
                        ? "bg-[#e63946] text-white shadow-lg shadow-red-500/20"
                        : "bg-white text-[#57575B] border border-[#DBDBE5] hover:bg-[#F3F3FC] hover:text-[#010507]"
                        }`}
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {isSharing ? "Stop" : "Share"}
                </button>

                <button
                    onClick={isMicOn ? stopMic : startMic}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-medium transition-all ${isMicOn
                        ? "bg-[#e63946] text-white shadow-lg shadow-red-500/20 animate-pulse"
                        : "bg-white text-[#57575B] border border-[#DBDBE5] hover:bg-[#F3F3FC] hover:text-[#010507]"
                        }`}
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    {isMicOn ? "Stop" : "Mic"}
                </button>
            </div>

            {/* Hidden video element for screen capture - using opacity/absolute to ensure frames render for canvas */}
            <video
                ref={screenVideoRef}
                className="absolute top-0 left-0 w-[1px] h-[1px] opacity-0 pointer-events-none -z-10"
                autoPlay
                playsInline
                muted
            />

            <style jsx>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.5; transform: scale(1.2); }
                }
            `}</style>
        </div>
    );
}
