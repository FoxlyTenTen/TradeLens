"""
Screen Share + Voice AI Server

A FastAPI WebSocket server that bridges the frontend to the Gemini Live API,
enabling real-time screen sharing and voice conversation.

Run with:
    python -m uvicorn screen_server:app --host 0.0.0.0 --port 9055

Protocol (Frontend -> Server):
    Binary message: raw PCM audio (Int16, 16kHz, mono)
    JSON text: { type: "screen_frame", data: "<base64 jpeg>" }
    JSON text: { type: "text", data: "user message" }

Protocol (Server -> Frontend):
    JSON text: { type: "audio", data: "<base64 pcm>" }
    JSON text: { type: "transcript", role: "agent", text: "..." }
    JSON text: { type: "turn_complete" }
    JSON text: { type: "session_started" }
    JSON text: { type: "session_resumed" }
    JSON text: { type: "error", message: "..." }
"""

import asyncio
import base64
import json
import logging
import os

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# --- Configuration ---
# Unset GOOGLE_APPLICATION_CREDENTIALS if it exists, so gcloud ADC is used
# (service account keys may belong to a different project)
if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
    logging.info(f"Unsetting GOOGLE_APPLICATION_CREDENTIALS (was: {os.getenv('GOOGLE_APPLICATION_CREDENTIALS')})")
    del os.environ["GOOGLE_APPLICATION_CREDENTIALS"]

USE_VERTEX = bool(os.getenv("GOOGLE_CLOUD_PROJECT"))

if USE_VERTEX:
    client = genai.Client(
        vertexai=True,
        project=os.getenv("GOOGLE_CLOUD_PROJECT"),
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )
    LIVE_MODEL = os.getenv("LIVE_MODEL", "gemini-live-2.5-flash-native-audio")
    logging.info(f"Using Vertex AI  |  project={os.getenv('GOOGLE_CLOUD_PROJECT')}  |  model={LIVE_MODEL}")
else:
    client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
    LIVE_MODEL = os.getenv("LIVE_MODEL", "gemini-2.0-flash-live-001")
    logging.info(f"Using AI Studio  |  model={LIVE_MODEL}")

SYSTEM_PROMPT = """
You are a friendly and helpful Guidance Agent for a beginner trader.

MISSION:
- Act as a supportive GUIDE to help the user make trading decisions and understand the market.
- Since the user is a BEGINNER, explain concepts simply and clearly if they seem confused or ask basic questions.
- Focus on the user's requests regarding bets, trading, and market analysis based on what you see on their screen.

CAPABILITIES:
- You verify the user's screen (charts, data, odds) to provide accurate guidance.
- You listen to the user's voice commands.

BEHAVIOR:
- Be NATURAL, warm, and encouraging. Talk like a helpful friend sitting next to them.
- If the user asks nicely or seems unsure, break things down.
- If the user asks to "make bets" or trade, analyze the screen and guide them safely through the process.
- Keep responses conversational but focused on the task at hand.
"""

# --- FastAPI App ---
app = FastAPI(title="Screen Share + Voice AI Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    return {"status": "ok", "model": LIVE_MODEL, "vertex": USE_VERTEX}


async def _safe_send(ws: WebSocket, data: dict, ws_closed: bool) -> bool:
    """Safely send JSON to the frontend WebSocket, returning False if it fails."""
    if ws_closed:
        return False
    try:
        await ws.send_text(json.dumps(data))
        return True
    except Exception:
        return False


@app.websocket("/ws/{user_id}")
async def websocket_endpoint(ws: WebSocket, user_id: str):
    await ws.accept()
    logging.info(f"[{user_id}] WebSocket connected")

    # Bridge queue: frontend messages are queued here, sender loop reads them
    bridge: asyncio.Queue = asyncio.Queue(maxsize=200)
    resumption_handle: str | None = None
    ws_closed = False
    MAX_RETRIES = 50  # Reconnect up to 50 times (~unlimited session)

    async def read_frontend():
        """Read messages from the frontend WebSocket and put them in the bridge queue."""
        nonlocal ws_closed
        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break

                if "bytes" in msg and msg["bytes"]:
                    # Binary = PCM audio
                    try:
                        bridge.put_nowait({"type": "audio", "data": msg["bytes"]})
                    except asyncio.QueueFull:
                        # Drop oldest audio to make room (audio is time-sensitive)
                        try:
                            bridge.get_nowait()
                            bridge.put_nowait({"type": "audio", "data": msg["bytes"]})
                        except Exception:
                            pass
                elif "text" in msg and msg["text"]:
                    try:
                        data = json.loads(msg["text"])
                        try:
                            bridge.put_nowait(data)
                        except asyncio.QueueFull:
                            # Drop oldest to make room for new data
                            try:
                                bridge.get_nowait()
                                bridge.put_nowait(data)
                            except Exception:
                                pass
                    except json.JSONDecodeError:
                        logging.warning(f"[{user_id}] Invalid JSON from frontend")
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logging.error(f"[{user_id}] Frontend reader error: {e}")
        finally:
            ws_closed = True
            logging.info(f"[{user_id}] Frontend reader ended")

    async def run_gemini_session():
        """Connect to Gemini Live, send queued items, receive responses. Auto-reconnects."""
        nonlocal resumption_handle

        for attempt in range(MAX_RETRIES):
            if ws_closed:
                break

            is_resumed = resumption_handle is not None or attempt > 0

            config = types.LiveConnectConfig(
                response_modalities=["AUDIO"],
                system_instruction=SYSTEM_PROMPT,
                media_resolution=types.MediaResolution.MEDIA_RESOLUTION_MEDIUM,
                context_window_compression=types.ContextWindowCompressionConfig(
                    trigger_tokens=100000,
                    sliding_window=types.SlidingWindow(target_tokens=80000),
                ),
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
                    )
                ),
                session_resumption=types.SessionResumptionConfig(
                    handle=resumption_handle,  # None on first connect, set on reconnect
                ),
            )

            receiver_exit_reason = "error"  # Track why the receiver exited

            try:
                async with client.aio.live.connect(model=LIVE_MODEL, config=config) as session:
                    if attempt == 0:
                        logging.info(f"[{user_id}] Gemini session started")
                        await _safe_send(ws, {"type": "session_started"}, ws_closed)
                    else:
                        logging.info(f"[{user_id}] Gemini session reconnected (attempt {attempt + 1}, handle={'yes' if resumption_handle else 'no'})")
                        await _safe_send(ws, {"type": "session_resumed"}, ws_closed)

                    session_alive = True

                    async def sender_loop():
                        """Read from bridge queue and send to Gemini."""
                        try:
                            while session_alive and not ws_closed:
                                try:
                                    item = await asyncio.wait_for(bridge.get(), timeout=0.5)
                                except asyncio.TimeoutError:
                                    continue

                                try:
                                    if item["type"] == "audio":
                                        audio_blob = types.Blob(
                                            mime_type="audio/pcm;rate=16000",
                                            data=item["data"],
                                        )
                                        await session.send_realtime_input(audio=audio_blob)

                                    elif item["type"] == "screen_frame":
                                        frame_bytes = base64.b64decode(item["data"])
                                        video_blob = types.Blob(
                                            mime_type="image/jpeg",
                                            data=frame_bytes,
                                        )
                                        await session.send_realtime_input(video=video_blob)

                                    elif item["type"] == "text":
                                        await session.send_client_content(
                                            turns=types.Content(
                                                role="user",
                                                parts=[types.Part(text=item["data"])],
                                            ),
                                            turn_complete=True,
                                        )
                                except Exception as send_err:
                                    logging.error(f"[{user_id}] Send item error: {send_err}")
                                    # If sending fails, the Gemini session is likely dead
                                    # Break out to trigger reconnection
                                    break
                        except asyncio.CancelledError:
                            raise
                        except Exception as e:
                            logging.error(f"[{user_id}] Sender loop error: {e}")
                        # NOTE: We do NOT set session_alive = False here.
                        # Only the receiver determines if the Gemini session ended.
                        # The sender exits when session_alive becomes False (set by receiver).

                    async def receiver_loop():
                        """Receive from Gemini and forward to frontend.

                        Returns a reason string:
                          'reconnect' - stream ended normally, should reconnect
                          'ended' - stream exhausted while session was still wanted
                          'ws_closed' - frontend disconnected
                          'capacity_error' - server overloaded (1011)
                          'error' - unexpected error
                        """
                        nonlocal session_alive, resumption_handle, receiver_exit_reason
                        try:
                            async for response in session.receive():
                                if ws_closed:
                                    receiver_exit_reason = "ws_closed"
                                    return

                                # Save resumption handle for reconnection
                                # (matches GenMedia Live pattern: check resumable + new_handle)
                                if response.session_resumption_update:
                                    update = response.session_resumption_update
                                    if update.resumable and update.new_handle:
                                        resumption_handle = update.new_handle
                                        logging.info(f"[{user_id}] Captured resumption handle")
                                    elif update.handle:
                                        # Fallback: some API versions use .handle directly
                                        resumption_handle = update.handle

                                if response.server_content and response.server_content.model_turn:
                                    for part in response.server_content.model_turn.parts:
                                        if part.inline_data:
                                            audio_b64 = base64.b64encode(part.inline_data.data).decode()
                                            await _safe_send(ws, {
                                                "type": "audio",
                                                "data": audio_b64,
                                                "mime_type": part.inline_data.mime_type,
                                            }, ws_closed)
                                        if part.text:
                                            await _safe_send(ws, {
                                                "type": "transcript",
                                                "role": "agent",
                                                "text": part.text,
                                            }, ws_closed)

                                if response.server_content and response.server_content.turn_complete:
                                    await _safe_send(ws, {"type": "turn_complete"}, ws_closed)

                            # If we exit the async for loop normally, the Gemini stream ended.
                            # This is the NORMAL case — Gemini closes the stream after some time.
                            # We should reconnect to continue the session.
                            receiver_exit_reason = "ended"
                            logging.info(f"[{user_id}] Gemini stream ended normally (will reconnect)")

                        except asyncio.CancelledError:
                            receiver_exit_reason = "cancelled"
                            raise
                        except Exception as e:
                            error_msg = str(e)
                            if "1011" in error_msg or "Insufficient model resources" in error_msg:
                                logging.error(f"[{user_id}] Server capacity error: {e}")
                                await _safe_send(ws, {
                                    "type": "error",
                                    "message": "Server overloaded. Please try again in a moment."
                                }, ws_closed)
                                receiver_exit_reason = "capacity_error"
                            elif "1000" in error_msg or "cancelled" in error_msg.lower():
                                # Normal close (1000) = Gemini ended its session cleanly
                                logging.info(f"[{user_id}] Gemini stream closed normally (code 1000), will reconnect")
                                receiver_exit_reason = "reconnect"
                            else:
                                logging.error(f"[{user_id}] Receiver error: {e}")
                                receiver_exit_reason = "error"
                        finally:
                            session_alive = False
                            logging.info(f"[{user_id}] Receiver ended (reason: {receiver_exit_reason})")

                    sender = asyncio.create_task(sender_loop())
                    receiver = asyncio.create_task(receiver_loop())

                    done, pending = await asyncio.wait(
                        [sender, receiver], return_when=asyncio.FIRST_COMPLETED
                    )
                    # Set session_alive = False to stop the other task
                    session_alive = False
                    for task in pending:
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass

            except Exception as e:
                error_msg = str(e)
                logging.error(f"[{user_id}] Session connect error (attempt {attempt + 1}): {e}")

                if "1011" in error_msg or "Insufficient model resources" in error_msg:
                    await _safe_send(ws, {
                        "type": "error",
                        "message": "Server overloaded. Please try again in a moment."
                    }, ws_closed)
                    break  # Don't retry on capacity errors

                receiver_exit_reason = "error"

            if ws_closed:
                break

            # Decide whether to reconnect based on exit reason
            should_reconnect = receiver_exit_reason in ("reconnect", "ended", "error")
            has_handle = resumption_handle is not None

            if should_reconnect and (has_handle or receiver_exit_reason in ("reconnect", "ended")):
                # Brief pause before reconnecting (exponential backoff capped at 2s)
                delay = min(0.5 * (1.2 ** min(attempt, 10)), 2.0)
                logging.info(f"[{user_id}] Reconnecting in {delay:.1f}s (attempt {attempt + 1}, reason={receiver_exit_reason}, handle={'yes' if has_handle else 'no'})")
                await asyncio.sleep(delay)
                continue
            elif receiver_exit_reason == "capacity_error":
                break
            elif receiver_exit_reason == "ws_closed":
                break
            else:
                # Unknown error — still try to reconnect a few times
                if attempt < 3:
                    logging.info(f"[{user_id}] Retrying after unknown error (attempt {attempt + 1})")
                    await asyncio.sleep(1.0)
                    continue
                else:
                    logging.error(f"[{user_id}] Too many errors, giving up")
                    await _safe_send(ws, {
                        "type": "error",
                        "message": "Session ended due to repeated errors."
                    }, ws_closed)
                    break

        logging.info(f"[{user_id}] Gemini session loop ended")

    # Run both concurrently: frontend reader + gemini session (with reconnection)
    frontend_task = asyncio.create_task(read_frontend())
    gemini_task = asyncio.create_task(run_gemini_session())

    done, pending = await asyncio.wait(
        [frontend_task, gemini_task], return_when=asyncio.FIRST_COMPLETED
    )
    ws_closed = True  # Signal everything to stop
    for task in pending:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    logging.info(f"[{user_id}] Session fully ended")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("SCREEN_SERVER_PORT", 9055))
    print(f"Starting Screen AI Server on http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
