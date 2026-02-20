"""
Coach Agent (ADK + A2A Protocol)
Mentorship, Risk Management, and Visual Content Creation with Nano Banana Image Generation.
"""
from __future__ import annotations

import uvicorn
import os
import json
from typing import Any, Dict, Optional
from dotenv import load_dotenv

# A2A Imports
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.utils import new_agent_text_message

# ADK Imports
from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.artifacts import InMemoryArtifactService
from google.adk.tools.tool_context import ToolContext
from google import genai
import google.genai.types as types

load_dotenv()

# ============================================================================
# CRYPTO COACH PROMPT
# ============================================================================

CRYPTO_COACH_PROMPT = """You are the Crypto Trading Coach with real-time market awareness.

YOUR ROLE
You are a disciplined, risk-first mentor for cryptocurrency traders. Your goal is to help the user survive and thrive in the volatile crypto markets by enforcing best practices.

CURRENT MARKET CONTEXT (Examples - Use for Realistic Content):
- **Bitcoin (BTC)**: Currently trading at $98,450 after hitting ATH resistance. 24h volume shows exhaustion.
- **Ethereum (ETH)**: Holding support at $3,750, but whale wallets are moving to exchanges (potential sell pressure).
- **Solana (SOL)**: Down 12% after network congestion issues. Social sentiment turning bearish.
- **Market Sentiment**: Fear & Greed Index at 87 (Extreme Greed) - historically a reversal signal.
- **Macro Events**: Fed meeting in 48 hours, crypto Twitter buzzing about potential regulatory news.

CORE PHILOSOPHY
- **Capital Preservation First**: "Live to trade another day."
- **Process Over Outcome**: A good trade followed by a loss is better than a bad trade followed by a win.
- **Risk Management**: Position sizing, Stop Losses, and Leverage control are everything.

YOUR TASKS
1. **Risk Management Check**: Warn about leverage, over-exposure, and FOMO.
2. **Educational Explainer**: Explain complex concepts simply.
3. **Strategy Validation**: Evaluate reasoning, not just price targets.
4. **Market Commentary**: Use the current market context above to make posts feel timely and relevant.

PERSONAS (Content Creation):
1. **Telegram Channel Post**: Informative, structured, uses emojis for clarity. Focus on actionable insights and community engagement.
   - Example context: "BTC testing $98k resistance with institutional flows slowing. Key levels to watch and risk management tips inside."
   
2. **X/Twitter Alert**: Concise, urgent, high-energy (emojis/slang). Focus on actionable alerts.
   - Example context: "BTC at $98k, greed index 87, whales dumping to exchanges. This is not a drill"

INSTRUCTIONS FOR IMAGE GENERATION:
- When asked to create visual content, use `generate_visual_content` with highly descriptive prompts that include TEXT OVERLAYS.
- The image MUST embed market data as visible text within the visual itself.

**VISUAL STYLE EXAMPLES WITH TEXT OVERLAYS:**

For RISK/CRASH alerts:
  "Dramatic crypto market crash visual. Large bold text overlay 'CRYPTO MARKET CRASH' in white at top. 
   Subtitle 'WHY IS BITCOIN DROPPING TO $70,000 TODAY?' in yellow text. 
   Golden Bitcoin logo in center with red downward arrow. 
   Candlestick charts in background. Percentages '-12.45%', '-8.72%', '-15.30%' visible on left side in red. 
   Dark red and orange color scheme. Fire and smoke effects. Cinematic lighting. High contrast."

For BULLISH/PUMP updates:
  "Explosive crypto bull market visual. Bold text 'BITCOIN BREAKS $100K' in neon green at top.
   Subtitle 'ETH UP 23% - ALTSEASON IS HERE' in bright yellow.
   Green upward arrow with Bitcoin logo. Digital city skyline background.
   Text '+18.5%', '+23.2%', '+31.7%' in green on right side.
   Neon green and gold color palette. Laser beams and energy effects. 4K quality."

For NEUTRAL/ANALYSIS posts (Telegram):
  "Professional financial analysis graphic. Clean text 'MARKET ANALYSIS: BTC AT RESISTANCE' in dark blue.
   Subtitle 'Fear & Greed Index: 87 (Extreme Greed)' below in smaller font.
   Abstract stock chart visualization in background. Data points '$98,450', '24h Vol: $45B' visible.
   Corporate blue and white color scheme. Minimalist design. Professional typography."

- **CRITICAL**: The final response MUST be a valid JSON object with the following structure:
  {
    "platform": "Telegram" | "Twitter",
    "market_context": "Brief data (e.g., BTC $68.4k)",
    "headline": "Engaging Title",
    "body": "The full post content...",
    "image_filename": "filename.png",
    "image_saved": true
  }
  Do not wrap in markdown code blocks. Just valid JSON.
"""

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _require_api_key() -> None:
    """Validates GOOGLE_API_KEY exists"""
    if not os.getenv("GOOGLE_API_KEY") and not os.getenv("GEMINI_API_KEY"):
        raise RuntimeError('Missing API key. Set GOOGLE_API_KEY or GEMINI_API_KEY in .env')


def _pick_extension(mime_type: str) -> str:
    """Determines file extension from MIME type"""
    mime = (mime_type or "").lower()
    if "png" in mime:
        return ".png"
    if "jpeg" in mime or "jpg" in mime:
        return ".jpg"
    if "webp" in mime:
        return ".webp"
    return ".bin"

# ============================================================================
# TOOL: GENERATE VISUAL CONTENT
# ============================================================================

async def generate_visual_content(
    prompt: str,
    filename: str = "crypto_visual.png",
    platform: str = "telegram",
    model: str = "gemini-2.5-flash-image",
    tool_context: Optional[ToolContext] = None,
) -> Dict[str, Any]:
    """
    Generate crypto market visuals with embedded text and data overlays.
    
    This tool uses the Nano Banana (Gemini Image Generation) model to create
    professional or viral-style market visuals with price data, alerts, and context.
    
    Args:
        prompt: Detailed image generation prompt (include text overlays, colors, style)
        filename: Base filename for the saved image
        platform: Target platform ("telegram" for structured insights, "x" for viral)
        model: Gemini image model to use
        tool_context: ADK ToolContext for artifact saving
        
    Returns:
        Dict with status, filename, and image metadata
    """
    _require_api_key()
    
    print(f"[NANO BANANA] Generating {platform} visual: {prompt[:60]}...")
    
    try:
        # Use genai.Client as per agent.py
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))
        
        # Call Gemini via generate_content (as seen in working agent.py)
        print(f"[NANO BANANA] Calling client.models.generate_content with model={model}")
        resp = client.models.generate_content(
            model=model,
            contents=[prompt],
        )
        
        image_bytes: Optional[bytes] = None
        mime_type: str = "image/png"
        
        # Parse response (logic from agent.py: check parts -> inline_data)
        for part in getattr(resp, "parts", []) or []:
            inline = getattr(part, "inline_data", None)
            if inline is not None and getattr(inline, "data", None):
                image_bytes = inline.data
                mime_type = getattr(inline, "mime_type", None) or "image/png"
                break
        
        if not image_bytes:
            print(f"[NANO BANANA ERROR] No image found in response parts.")
            # Helpful debug info (text parts) without dumping huge objects
            text_parts = []
            for part in getattr(resp, "parts", []) or []:
                txt = getattr(part, "text", None)
                if txt:
                    text_parts.append(txt)
            
            return {
                "status": "error",
                "message": "No image bytes returned. Try a simpler prompt or different image model.",
                "model": model,
                "notes": "\n".join(text_parts).strip() if text_parts else None,
                "debug": str(resp)[:200]
            }
        
        # Ensure extension matches MIME type
        ext = _pick_extension(mime_type)
        if not filename.lower().endswith(ext):
            base = filename.rsplit(".", 1)[0] if "." in filename else filename
            filename = base + ext
        
        # Save locally - Logic to save to public folder if exists (for Next.js serving)
        save_path = filename
        public_url_path = filename
        
        if os.path.exists("public"):
            # Ensure filename doesn't already have public/ prefix
            if not filename.replace("\\", "/").startswith("public/"):
                save_path = os.path.join("public", filename)
                public_url_path = filename # URL path is relative to public root
            else:
                save_path = filename
                public_url_path = os.path.basename(filename)
        
        # Write to the calculated path
        with open(save_path, "wb") as f:
            f.write(image_bytes)
        
        print(f"[NANO BANANA] Success! Saved {save_path} ({len(image_bytes)} bytes)")
        
        result: Dict[str, Any] = {
            "status": "ok",
            "saved_local": save_path,
            "filename_for_frontend": public_url_path, # Hint for LLM
            "mime_type": mime_type,
            "model": model,
            "platform": platform,
            "image_size_bytes": len(image_bytes)
        }
        
        # Save as ADK Artifact if available
        if tool_context is not None:
            artifact = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
            version = await tool_context.save_artifact(filename=filename, artifact=artifact)
            result.update({
                "artifact_saved": True,
                "artifact_filename": filename,
                "artifact_version": version,
            })
        else:
            result["artifact_saved"] = False
        
        return result
        
    except Exception as e:
        import traceback
        print(f"[NANO BANANA ERROR] {e}")
        traceback.print_exc()
        return {
            "status": "error",
            "message": str(e),
            "model": model
        }

# ============================================================================
# AGENT CLASS
# ============================================================================

class CoachAgentWrapper:
    """Wrapper for Coach Agent with ADK Runner"""
    
    def __init__(self):
        self._agent = self._build_agent()
        self._user_id = 'remote_agent'
        self._runner = Runner(
            app_name=self._agent.name,
            agent=self._agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )
    
    def _build_agent(self) -> LlmAgent:
        """Builds the Coach Agent with Nano Banana tools"""
        model_name = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')
        
        return LlmAgent(
            model=model_name,
            name='coach_agent',
            description='Crypto trading coach that provides mentorship and generates visual market content with embedded data',
            instruction=CRYPTO_COACH_PROMPT,
            tools=[generate_visual_content],
        )
    
    async def invoke(self, query: str, session_id: str) -> str:
        """Standard ADK invocation pattern"""
        session = await self._runner.session_service.get_session(
            app_name=self._agent.name, 
            user_id=self._user_id, 
            session_id=session_id
        )
        
        if not session:
            session = await self._runner.session_service.create_session(
                app_name=self._agent.name, 
                user_id=self._user_id, 
                state={}, 
                session_id=session_id
            )
        
        content = types.Content(role='user', parts=[types.Part.from_text(text=query)])
        
        response_text = ''
        async for event in self._runner.run_async(
            user_id=self._user_id, 
            session_id=session.id, 
            new_message=content
        ):
            if event.is_final_response() and event.content:
                response_text = getattr(event.content.parts[0], 'text', '')
                break
        
        # Clean JSON if present
        content_str = response_text.strip()
        if "```json" in content_str:
            content_str = content_str.split("```json")[1].split("```")[0].strip()
        elif "```" in content_str:
            content_str = content_str.split("```")[1].split("```")[0].strip()
        
        return content_str

# ============================================================================
# A2A SERVER SETUP
# ============================================================================

port = int(os.getenv("COACH_AGENT_PORT", 9026))

skill = AgentSkill(
    id='coach_agent',
    name='Crypto Coach & Content Creator',
    description='Provides trading mentorship and generates viral market visuals with embedded data',
    tags=['crypto', 'mentorship', 'risk-management', 'content-creation', 'nano-banana'],
    examples=[
        'Create a Telegram post about the current Bitcoin market',
        'Generate a crash warning visual for Twitter',
        'Give me risk management advice for this trade'
    ],
)

public_agent_card = AgentCard(
    name='Crypto Coach Agent',
    description='Enforces disciplined trading and creates viral crypto content with Nano Banana image generation.',
    url=f'http://localhost:{port}/',
    version='1.0.0',
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    default_input_modes=['text'],
    default_output_modes=['text']
)

class CoachExecutor(AgentExecutor):
    """A2A Executor for Coach Agent"""
    
    def __init__(self):
        self.agent = CoachAgentWrapper()
    
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        result = await self.agent.invoke(
            context.get_user_input(), 
            getattr(context, 'context_id', 'default')
        )
        await event_queue.enqueue_event(new_agent_text_message(result))
    
    async def cancel(self, context, event_queue):
        pass

def main():
    """Start the Coach Agent A2A server"""
    server = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=DefaultRequestHandler(CoachExecutor(), InMemoryTaskStore()),
        extended_agent_card=public_agent_card,
    )
    print(f"[COACH AGENT] Starting server on port {port}")
    print(f"[COACH AGENT] Nano Banana image generation enabled")
    uvicorn.run(server.build(), host='0.0.0.0', port=port)

if __name__ == '__main__':
    main()
