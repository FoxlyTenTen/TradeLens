
import trafilatura
import sys

print("Trafilatura imported successfully")
try:
    html = "<html><body><h1>Hello World</h1><p>This is a test.</p></body></html>"
    text = trafilatura.extract(html)
    print(f"Extraction result: {text}")
except Exception as e:
    print(f"Error during extraction: {e}")
    sys.exit(1)
