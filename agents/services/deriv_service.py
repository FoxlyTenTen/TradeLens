import os
import json
import asyncio
import websockets
try:
    from agents.services.supabase_client import get_supabase
except ImportError:
    try:
        from services.supabase_client import get_supabase
    except ImportError:
        def get_supabase(): raise ImportError("Could not import get_supabase")

async def sync_user_trades(user_token: str, user_id: str = None):
    """
    Connects to Deriv via WebSocket, fetches trade history (profit_table),
    and syncs it to Supabase.
    """
    app_id = os.environ.get("DERIV_APP_ID", "1089")
    uri = f"wss://ws.derivws.com/websockets/v3?app_id={app_id}"
    supabase = get_supabase()

    async with websockets.connect(uri) as websocket:
        print(f"🔌 Connected to Deriv (App ID: {app_id}). Authorizing...")
        
        # Step 1: Authorize
        await websocket.send(json.dumps({"authorize": user_token}))
        
        # We'll store the ID we get from authorization
        final_user_id = user_id

        while True:
            response = await websocket.recv()
            data = json.loads(response)
            
            if data.get("error"):
                print(f"❌ Deriv Error: {data['error']['message']}")
                return

            msg_type = data.get("msg_type")

            # Step 2: Once Authorized, Request History
            if msg_type == "authorize":
                auth_data = data.get("authorize", {})
                loginid = auth_data.get("loginid")
                deriv_user_id = str(auth_data.get("user_id")) # The numeric ID
                is_demo = auth_data.get("is_virtual") == 1
                
                # If no user_id was provided to the function, use the one from Deriv
                if not final_user_id:
                    final_user_id = deriv_user_id

                print(f"✅ Authorized: {loginid} (User ID: {deriv_user_id})")
                print(f"📈 Account Type: {'DEMO' if is_demo else 'REAL'}")
                print(f"💡 TO ENABLE BEHAVIOR AGENT: Set DEMO_USER_ID={deriv_user_id} in your .env file.")
                
                print("Fetching Profit Table...")
                await websocket.send(json.dumps({
                    "profit_table": 1,
                    "description": 1,
                    "limit": 50,
                    "sort": "DESC"
                }))

            # Step 3: Process the History
            if msg_type == "profit_table":
                transactions = data.get("profit_table", {}).get("transactions", [])
                print(f"📥 Received {len(transactions)} trades.")

                if not transactions:
                    print("No transactions found.")
                    return

                # Prepare for Database Upsert
                db_rows = []
                for t in transactions:
                    profit = float(t.get("sell_price", 0)) - float(t.get("buy_price", 0))
                    
                    db_rows.append({
                        "transaction_id": t["transaction_id"],
                        "user_id": final_user_id, # Use the ID from auth
                        "symbol": t.get("shortcode", "Unknown"),
                        "buy_time": t["purchase_time"],
                        "sell_time": t.get("sell_time"),
                        "buy_price": float(t.get("buy_price", 0)),
                        "sell_price": float(t.get("sell_price", 0)),
                        "profit": profit,
                        "status": "WON" if profit > 0 else "LOST"
                    })

                # Step 4: Upsert into Supabase
                try:
                    # 'execute()' returns the data in a 'data' attribute
                    res = supabase.table("trade_history").upsert(
                        db_rows, on_conflict="transaction_id"
                    ).execute()
                    print("💾 History synced to Supabase successfully.")
                except Exception as e:
                    print(f"❌ Supabase Error: {e}")

                # Sync complete, exit loop
                break
