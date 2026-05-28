import sys
import time
import requests
from bs4 import BeautifulSoup
import json

def scrape_wikipedia(keyword):
    """Simple Wikipedia scraper for demonstration."""
    url = f"https://en.wikipedia.org/wiki/{keyword.replace(' ', '_')}"
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            soup = BeautifulSoup(response.content, 'html.parser')
            # Get first 3 paragraphs
            paragraphs = soup.find_all('p')
            text_blocks = []
            for p in paragraphs:
                text = p.get_text().strip()
                if len(text) > 50:
                    text_blocks.append(text)
                if len(text_blocks) >= 3:
                    break
            return " ".join(text_blocks)
    except Exception as e:
        pass
    return None

def main():
    if len(sys.argv) < 2:
        print("Usage: python scraper.py <keyword1,keyword2...>")
        sys.exit(1)
        
    keywords = sys.argv[1].split(',')
    
    print(f"Scraper started monitoring for: {keywords}")
    sys.stdout.flush()
    
    while True:
        for kw in keywords:
            kw = kw.strip()
            if not kw: continue
            
            # Simulate scraping delay and real-time finding
            time.sleep(3)
            
            scraped_text = scrape_wikipedia(kw)
            if scraped_text:
                # Output JSON string for Node.js to easily parse
                output = {
                    "subject": kw,
                    "text": scraped_text,
                    "timestamp": time.time()
                }
                print(json.dumps(output))
                sys.stdout.flush()
                
            # Sleep longer between keywords to simulate organic scraping
            time.sleep(5)

if __name__ == "__main__":
    main()
