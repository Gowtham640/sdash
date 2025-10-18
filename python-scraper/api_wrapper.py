#!/usr/bin/env python3
"""
SRM Academia Portal Scraper - API Wrapper for Next.js Integration
Uses persistent Chrome profile-based session management
"""

from persistent_portal_scraper import fetch_portal_data, close_persistent_scraper
import sys
import json

# ============================================================================
# API FUNCTIONS FOR NEXT.JS INTEGRATION
# ============================================================================

def api_get_calendar_data(email, password):
    """API function to get calendar data using persistent session"""
    try:
        print(f"[API] Getting calendar data for: {email}", file=sys.stderr)
        
        # Use the persistent scraper
        result = fetch_portal_data(
            url="https://academia.srmist.edu.in/#Page:Academic_Planner_2025_26_ODD",
            email=email,
            password=password,
            extract_data=True
        )
        
        if result and result.get('success'):
            return {
                "success": True,
                "data": result.get('data', []),
                "type": "calendar"
            }
        else:
            return {"success": False, "error": result.get('error', 'No calendar data found')}
    except Exception as e:
        return {"success": False, "error": f"API Error: {str(e)}"}

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