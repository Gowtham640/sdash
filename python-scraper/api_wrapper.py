#!/usr/bin/env python3
"""
API Wrapper for SRM Academia Portal Scraper
Provides clean functions for Next.js to call
Based on the working standalone code with smart caching
"""

import sys
import json
import time
import os
from datetime import datetime, timedelta
from scraper_selenium_session import SRMAcademiaScraperSelenium
from calendar_scraper_fixed import extract_calendar_data_from_html
from timetable_scraper import api_get_timetable_data

# ============================================================================
# CACHING CONFIGURATION
# ============================================================================

CACHE_FILE = "calendar_cache.json"
CACHE_DURATION_HOURS = 6  # Cache for 6 hours


def is_cache_valid():
    """Check if cached calendar data is still valid"""
    if not os.path.exists(CACHE_FILE):
        print("[CACHE] No cache file found", file=sys.stderr)
        return False

    try:
        with open(CACHE_FILE, 'r') as f:
            cache_data = json.load(f)

        cache_time_str = cache_data.get('timestamp', '')
        if not cache_time_str:
            print("[CACHE] No timestamp in cache", file=sys.stderr)
            return False

        cache_time = datetime.fromisoformat(cache_time_str)
        if datetime.now() - cache_time > timedelta(hours=CACHE_DURATION_HOURS):
            print("[CACHE] Cache expired", file=sys.stderr)
            return False

        print("[CACHE] Cache is valid", file=sys.stderr)
        return True
    except Exception as e:
        print(f"[CACHE] Error reading cache: {e}", file=sys.stderr)
        return False


def get_cached_calendar_data():
    """Get calendar data from cache"""
    try:
        with open(CACHE_FILE, 'r') as f:
            cache_data = json.load(f)
        data = cache_data.get('data', [])
        print(f"[CACHE] Retrieved {len(data)} entries from cache", file=sys.stderr)
        return data
    except Exception as e:
        print(f"[CACHE] Error reading cached data: {e}", file=sys.stderr)
        return []


def save_calendar_cache(calendar_data):
    """Save calendar data to cache"""
    try:
        cache_data = {
            'data': calendar_data,
            'timestamp': datetime.now().isoformat(),
            'count': len(calendar_data),
            'cache_duration_hours': CACHE_DURATION_HOURS
        }
        with open(CACHE_FILE, 'w') as f:
            json.dump(cache_data, f, indent=2)
        print(f"[CACHE] Saved {len(calendar_data)} entries to cache", file=sys.stderr)
    except Exception as e:
        print(f"[CACHE] Error saving cache: {e}", file=sys.stderr)


# ============================================================================
# API FUNCTIONS FOR NEXT.JS INTEGRATION
# ============================================================================

def api_get_calendar_data(email, password, force_refresh=False):
    """API function to get calendar data with smart caching"""
    scraper = None
    try:
        print(f"[API] Getting calendar data for: {email}", file=sys.stderr)

        # Check cache first (unless force refresh)
        if not force_refresh and is_cache_valid():
            cached_data = get_cached_calendar_data()
            if cached_data:
                print(f"[CACHE] Using cached data ({len(cached_data)} entries)", file=sys.stderr)
                return {
                    "success": True,
                    "data": cached_data,
                    "type": "calendar",
                    "count": len(cached_data),
                    "cached": True,
                    "cache_timestamp": datetime.now().isoformat()
                }

        print("[CACHE] Cache expired or empty - fetching fresh data", file=sys.stderr)

        # Initialize scraper with session management
        scraper = SRMAcademiaScraperSelenium(headless=True, use_session=True)

        html_content = None
        # Try to get data with existing session first
        if scraper.is_session_valid():
            print("[API] Valid session found - trying to get data without login", file=sys.stderr)
            html_content = scraper.get_calendar_data()

        # If session was invalid or data fetch failed, attempt login
        if html_content is None:
            print("[API] Session invalid or expired - attempting login", file=sys.stderr)
            if not scraper.login(email, password):
                print("[API] Login failed!", file=sys.stderr)
                return {"success": False, "error": "Login failed"}
            print("[API] Login successful!", file=sys.stderr)
            html_content = scraper.get_calendar_data()

        if not html_content:
            print("[API] Failed to get calendar HTML content after all attempts", file=sys.stderr)
            return {"success": False, "error": "Failed to get calendar data"}

        print(f"[API] Got HTML content ({len(html_content)} characters)", file=sys.stderr)
        calendar_data = extract_calendar_data_from_html(html_content)

        if calendar_data:
            print(f"[API] Successfully extracted {len(calendar_data)} calendar entries", file=sys.stderr)
            save_calendar_cache(calendar_data)
            return {
                "success": True,
                "data": calendar_data,
                "type": "calendar",
                "count": len(calendar_data),
                "cached": False,
                "fresh_data": True
            }
        else:
            print("[API] No calendar data extracted", file=sys.stderr)
            return {
                "success": True,
                "data": [],
                "type": "calendar",
                "count": 0,
                "cached": False
            }
        
    except Exception as e:
        print(f"[API] Error getting calendar data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)

        if not force_refresh:
            cached_data = get_cached_calendar_data()
            if cached_data:
                print("[CACHE] Scraping failed, using stale cache as fallback", file=sys.stderr)
                return {
                    "success": True,
                    "data": cached_data,
                    "type": "calendar",
                    "count": len(cached_data),
                    "cached": True,
                    "stale": True,
                    "fallback": True
                }
        return {"success": False, "error": f"API Error: {str(e)}"}
    
    finally:
        if scraper:
            try:
                scraper.close()
                print("[API] Scraper closed", file=sys.stderr)
            except Exception as e:
                print(f"[API] Error closing scraper: {e}", file=sys.stderr)


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    try:
        # Read JSON input from stdin
        input_data = json.loads(sys.stdin.read())

        action = input_data.get('action')
        email = input_data.get('email')
        password = input_data.get('password')
        force_refresh = input_data.get('force_refresh', False)

        if not email or not password:
            print(json.dumps({"success": False, "error": "Email and password required"}))
            sys.exit(1)

        if action == 'get_calendar_data':
            result = api_get_calendar_data(email, password, force_refresh)
        elif action == 'get_timetable_data':
            result = api_get_timetable_data(email, password)
        else:
            result = {"success": False, "error": "Unknown action"}
        
        # Output result as JSON (only once)
        print(json.dumps(result))
        sys.exit(0)
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

