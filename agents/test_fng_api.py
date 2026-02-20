import urllib.request
import json
from datetime import datetime, timezone

def test_api():
    print("Fetching data from Alternative.me Fear and Greed Index API...")
    url = "https://api.alternative.me/fng/?limit=2&format=json"
    
    req = urllib.request.Request(
        url, 
        data=None, 
        headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
        }
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            
        print("\n--- RAW API RESPONSE ---")
        print(json.dumps(data, indent=2))
        
        print("\n--- PROCESSED DATA (Simulating Agent Logic) ---")
        if not data.get('data') or len(data['data']) < 1:
             print("ERROR: API returned no data")
             return

        latest = data['data'][0]
        val = int(latest['value'])
        classification = latest['value_classification']
        api_time = datetime.fromtimestamp(int(latest['timestamp']), timezone.utc)
        
        change_24h = 0
        if len(data['data']) >= 2:
            prev_val = int(data['data'][1]['value'])
            change_24h = val - prev_val
            
        print(f"Value: {val}")
        print(f"Classification: {classification}")
        print(f"Timestamp: {api_time.isoformat()}")
        print(f"Previous Value: {prev_val}")
        print(f"24h Change: {change_24h}")
        
    except Exception as e:
        print(f"Error fetching API: {e}")

if __name__ == "__main__":
    test_api()
