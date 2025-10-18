#!/usr/bin/env python3
"""
API Wrapper for SRM Academia Portal Scraper
Provides clean functions for Next.js to call
Based on the working standalone code
"""

import sys
import json
import time
from scraper_selenium_session import SRMAcademiaScraperSelenium
from calendar_scraper_fixed import extract_calendar_data_from_html

# ============================================================================
# API FUNCTIONS FOR NEXT.JS INTEGRATION
# ============================================================================

def api_get_calendar_data(email, password):
    """API function to get calendar data using the working scraper approach"""
    scraper = None
    try:
        print(f"[API] Getting calendar data for: {email}", file=sys.stderr)
        
        # Initialize scraper with session management (exactly like working code)
        scraper = SRMAcademiaScraperSelenium(headless=True, use_session=True)
        
        # Check if we have a valid session first
        if scraper.is_session_valid():
            print("[API] Valid session found - skipping login", file=sys.stderr)
            
            # Try to get calendar data without login
            print("[API] Getting calendar HTML content...", file=sys.stderr)
            html_content = scraper.get_calendar_data()
            
            if html_content:
                print(f"[API] Got HTML content ({len(html_content)} characters)", file=sys.stderr)
                
                # Extract calendar data using the proven extraction logic
                print("[API] Extracting calendar data...", file=sys.stderr)
                calendar_data = extract_calendar_data_from_html(html_content)
                
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
            else:
                print("[API] Session expired - need to login", file=sys.stderr)
        
        # If no valid session or session expired, login
        print(f"[API] Logging in for: {email}", file=sys.stderr)
        if not scraper.login(email, password):
            print("[API] Login failed!", file=sys.stderr)
            return {"success": False, "error": "Login failed"}
        
        print("[API] Login successful!", file=sys.stderr)
        
        # Get calendar data using the working method
        print("[API] Getting calendar HTML content...", file=sys.stderr)
        html_content = scraper.get_calendar_data()
        
        if not html_content:
            print("[API] Failed to get calendar HTML content", file=sys.stderr)
            return {"success": False, "error": "Failed to get calendar data"}
        
        print(f"[API] Got HTML content ({len(html_content)} characters)", file=sys.stderr)
        
        # Extract calendar data using the proven extraction logic
        print("[API] Extracting calendar data...", file=sys.stderr)
        calendar_data = extract_calendar_data_from_html(html_content)
        
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