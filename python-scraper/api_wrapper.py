#!/usr/bin/env python3
"""
SRM Academia Portal Scraper - API Wrapper for Next.js Integration
Uses persistent Chrome profile-based session management
"""

from scraper_selenium import SRMAcademiaScraperSelenium
from calendar_scraper_fixed import extract_calendar_data_from_html
import sys
import json
import time

# ============================================================================
# API FUNCTIONS FOR NEXT.JS INTEGRATION
# ============================================================================

def api_get_calendar_data(email, password):
    """API function to get calendar data using the same approach as working standalone code"""
    scraper = None
    try:
        print(f"[API] Getting calendar data for: {email}", file=sys.stderr)
        
        # Use the same scraper class as working code, but in headless mode
        scraper = SRMAcademiaScraperSelenium(headless=True)
        
        # Login using the same method as working code
        print(f"[API] Logging in with: {email}", file=sys.stderr)
        if not scraper.login(email, password):
            print("[API] Login failed!", file=sys.stderr)
            return {"success": False, "error": "Login failed"}
        
        print("[API] Login successful!", file=sys.stderr)
        
        # Navigate to calendar page using the same URL as working code
        planner_url = "https://academia.srmist.edu.in/#Page:Academic_Planner_2025_26_ODD"
        print(f"[API] Navigating to: {planner_url}", file=sys.stderr)
        scraper.driver.get(planner_url)
        
        # Wait for page to load - same timing as working code
        print("[API] Waiting for page to load...", file=sys.stderr)
        time.sleep(10)  # Same 10 seconds as working code
        
        # Extract calendar data using direct page source - same as working code
        print("[API] Extracting calendar data...", file=sys.stderr)
        calendar_data = extract_calendar_data_from_html(scraper.driver.page_source)
        
        if calendar_data:
            print(f"[API] Successfully extracted {len(calendar_data)} calendar entries", file=sys.stderr)
            return {
                "success": True,
                "data": calendar_data,
                "type": "calendar",
                "count": len(calendar_data)
            }
        else:
            print("[API] No calendar data extracted", file=sys.stderr)
            return {
                "success": True,
                "data": [],
                "type": "calendar",
                "count": 0
            }
            
    except Exception as e:
        print(f"[API] Error getting calendar data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {"success": False, "error": f"API Error: {str(e)}"}
    finally:
        # Always close the scraper
        if scraper:
            try:
                scraper.close()
                print("[API] Scraper closed", file=sys.stderr)
            except Exception as e:
                print(f"[API] Error closing scraper: {e}", file=sys.stderr)

if __name__ == "__main__":
    import sys
    import json
    
    # Check if we're being called from Next.js API (no arguments)
    if len(sys.argv) == 1:
        try:
            # Read JSON input from stdin
            input_data = json.loads(sys.stdin.read())
            
            action = input_data.get('action')
            email = input_data.get('email')
            password = input_data.get('password')
            
            if not email or not password:
                print(json.dumps({"success": False, "error": "Email and password required"}))
                sys.exit(1)
            
            if action == 'get_calendar_data':
                result = api_get_calendar_data(email, password)
            else:
                result = {"success": False, "error": "Unknown action"}
        
            # Output result as JSON (only once)
            print(json.dumps(result))
            sys.exit(0)  # Exit immediately after outputting result
            
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
            sys.exit(1)  # Exit immediately after outputting error
    else:
        # Handle command line arguments for standalone usage
        print("API Wrapper - Use without arguments for Next.js integration")
        print("Available actions: get_calendar_data")
