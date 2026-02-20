
import trafilatura
import json
import asyncio
import httpx

async def test_extract():
    url = "https://www.example.com"
    print(f"Fetching {url}...")
    async with httpx.AsyncClient() as client:
        r = await client.get(url)
        html = r.text

    print(f"Extracting from {len(html)} chars...")
    try:
        extracted_json = trafilatura.extract(
            html,
            output_format="json",
            with_metadata=True,
            favor_precision=True,
        )
        if extracted_json:
            data = json.loads(extracted_json)
            print("Extraction successful!")
            print(json.dumps(data, indent=2))
        else:
            print("Extraction returned None")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_extract())
