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
import re
from bs4 import BeautifulSoup

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


def get_attendance_page_html(scraper):
    """Get the HTML content of the attendance page"""
    try:
        print("\n=== NAVIGATING TO ATTENDANCE PAGE ===", file=sys.stderr)
        
        # Navigate to the attendance page
        attendance_url = "https://academia.srmist.edu.in/#Page:My_Attendance"
        print(f"[STEP 1] Navigating to: {attendance_url}", file=sys.stderr)
        
        scraper.driver.get(attendance_url)
        time.sleep(5)
        
        print(f"[OK] Current URL: {scraper.driver.current_url}", file=sys.stderr)
        print(f"[OK] Page title: {scraper.driver.title}", file=sys.stderr)
        
        # Wait for page to load completely
        scraper.wait.until(
            lambda driver: driver.execute_script("return document.readyState") == "complete"
        )
        
        print("[OK] Attendance page loaded successfully", file=sys.stderr)
        
        # Get page source
        page_source = scraper.driver.page_source
        
        return page_source
        
    except Exception as e:
        print(f"[FAIL] Error getting attendance page: {e}", file=sys.stderr)
        return None


def extract_attendance_data_from_html(html_content):
    """
    Extract attendance data from HTML content using BeautifulSoup.
    Based on the HTML structure: table with tr rows containing subject data.
    """
    attendance_data = []
    
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Check if page shows access denied
        page_text = soup.get_text().lower()
        if 'not accessible' in page_text or 'not allowed to access' in page_text:
            print("[ERROR] Access denied to attendance page", file=sys.stderr)
            return attendance_data
        
        # Find all tables
        tables = soup.find_all('table')
        print(f"Found {len(tables)} tables on the page", file=sys.stderr)
        
        # Also look for divs that might contain table-like data
        divs_with_tables = soup.find_all('div', class_=lambda x: x and 'table' in x.lower())
        print(f"Found {len(divs_with_tables)} divs with table classes", file=sys.stderr)
        
        # Look for the main attendance table
        main_table = None
        
        # First, try to find table with attendance-related content
        for i, table in enumerate(tables):
            table_text = table.get_text().lower()
            if any(keyword in table_text for keyword in ['attendance', 'hours conducted', 'absent', 'theory', 'lab', 'subject', 'course']):
                print(f"Found potential attendance table {i}", file=sys.stderr)
                main_table = table
                break
        
        # If no table found, look for divs that might contain table data
        if not main_table:
            for i, div in enumerate(divs_with_tables):
                div_text = div.get_text().lower()
                if any(keyword in div_text for keyword in ['attendance', 'hours conducted', 'absent', 'theory', 'lab']):
                    print(f"Found potential attendance div {i}", file=sys.stderr)
                    # Look for table inside this div
                    inner_table = div.find('table')
                    if inner_table:
                        main_table = inner_table
                        break
        
        # If still no table found, try to find any table with multiple rows
        if not main_table:
            print("No attendance-specific table found, trying any table with data", file=sys.stderr)
            for table in tables:
                rows = table.find_all('tr')
                if len(rows) > 1:  # More than just header
                    print(f"Found table with {len(rows)} rows", file=sys.stderr)
                    main_table = table
                    break
        
        if not main_table:
            print("No suitable table found", file=sys.stderr)
            return attendance_data
        
        print("Processing attendance table...", file=sys.stderr)
        
        # Get all rows from the table
        rows = main_table.find_all('tr')
        print(f"Found {len(rows)} rows in attendance table", file=sys.stderr)
        
        # Process each row (skip first empty row if it exists)
        for i, row in enumerate(rows):
            cells = row.find_all('td')
            
            # Skip rows with insufficient cells or empty rows
            if len(cells) < 9:
                print(f"Skipping row {i}: insufficient cells ({len(cells)})", file=sys.stderr)
                continue
            
            # Check if this is a data row (not header)
            row_text = row.get_text(strip=True)
            if not row_text or len(row_text) < 10:  # Skip empty or very short rows
                print(f"Skipping row {i}: empty or too short", file=sys.stderr)
                continue
            
            try:
                # Extract data from each cell
                subject_code = cells[0].get_text(strip=True)
                course_title = cells[1].get_text(strip=True)
                category = cells[2].get_text(strip=True)
                faculty_name = cells[3].get_text(strip=True)
                slot = cells[4].get_text(strip=True) if len(cells) > 4 else ""
                room = cells[5].get_text(strip=True) if len(cells) > 5 else ""
                hours_conducted = cells[6].get_text(strip=True)
                hours_absent = cells[7].get_text(strip=True)
                attendance = cells[8].get_text(strip=True)
                
                # Validate that we have meaningful data
                if course_title and course_title != "Course Title":  # Skip header row
                    attendance_entry = {
                        'row_number': i,
                        'subject_code': subject_code,
                        'course_title': course_title,
                        'category': category,
                        'faculty_name': faculty_name,
                        'slot': slot,
                        'room': room,
                        'hours_conducted': hours_conducted,
                        'hours_absent': hours_absent,
                        'attendance': attendance,
                        'attendance_percentage': calculate_attendance_percentage(hours_conducted, hours_absent)
                    }
                    
                    attendance_data.append(attendance_entry)
                    print(f"[DATA] Row {i}: {course_title} - {attendance}% attendance", file=sys.stderr)
                
            except Exception as e:
                print(f"[WARN] Error processing row {i}: {e}", file=sys.stderr)
                continue
        
        print(f"Extracted {len(attendance_data)} attendance entries", file=sys.stderr)
    
    except Exception as e:
        print(f"Error extracting attendance data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
    
    return attendance_data


def calculate_attendance_percentage(hours_conducted, hours_absent):
    """Calculate attendance percentage"""
    try:
        conducted = int(hours_conducted) if hours_conducted.isdigit() else 0
        absent = int(hours_absent) if hours_absent.isdigit() else 0
        
        if conducted == 0:
            return "0%"
        
        attended = conducted - absent
        percentage = (attended / conducted) * 100
        return f"{percentage:.1f}%"
    
    except Exception:
        return "N/A"


def create_attendance_json(attendance_data):
    """Create JSON structure with attendance data"""
    
    # Calculate summary statistics
    total_subjects = len(attendance_data)
    total_hours_conducted = 0
    total_hours_absent = 0
    
    for entry in attendance_data:
        try:
            total_hours_conducted += int(entry['hours_conducted']) if entry['hours_conducted'].isdigit() else 0
            total_hours_absent += int(entry['hours_absent']) if entry['hours_absent'].isdigit() else 0
        except:
            continue
    
    overall_attendance = calculate_attendance_percentage(str(total_hours_conducted), str(total_hours_absent))
    
    # Group by category
    theory_subjects = [entry for entry in attendance_data if entry['category'].lower() == 'theory']
    lab_subjects = [entry for entry in attendance_data if entry['category'].lower() == 'lab']
    other_subjects = [entry for entry in attendance_data if entry['category'].lower() not in ['theory', 'lab']]
    
    # Create the complete JSON structure
    attendance_json = {
        "metadata": {
            "generated_at": datetime.now().isoformat(),
            "source": "SRM Academia Portal",
            "academic_year": "2025-26 ODD",
            "institution": "SRM Institute of Science and Technology",
            "college": "College of Engineering and Technology",
            "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        },
        "summary": {
            "total_subjects": total_subjects,
            "theory_subjects": len(theory_subjects),
            "lab_subjects": len(lab_subjects),
            "other_subjects": len(other_subjects),
            "total_hours_conducted": total_hours_conducted,
            "total_hours_absent": total_hours_absent,
            "overall_attendance_percentage": overall_attendance
        },
        "subjects": {
            "theory": theory_subjects,
            "lab": lab_subjects,
            "other": other_subjects
        },
        "all_subjects": attendance_data
    }
    
    return attendance_json


def api_get_attendance_data(email, password):
    """API function to get attendance data with session management"""
    scraper = None
    try:
        print(f"[API] Getting attendance data for: {email}", file=sys.stderr)
        
        # Initialize scraper with session management
        scraper = SRMAcademiaScraperSelenium(headless=True, use_session=True)
        
        html_content = None
        # Try to get data with existing session first
        if scraper.is_session_valid():
            print("[API] Valid session found - trying to get data without login", file=sys.stderr)
            html_content = get_attendance_page_html(scraper)
        
        # If session was invalid or data fetch failed, attempt login
        if html_content is None:
            print("[API] Session invalid or expired - attempting login", file=sys.stderr)
            if not scraper.login(email, password):
                print("[API] Login failed!", file=sys.stderr)
                return {"success": False, "error": "Login failed"}
            print("[API] Login successful!", file=sys.stderr)
            html_content = get_attendance_page_html(scraper)

        if not html_content:
            print("[API] Failed to get attendance HTML content after all attempts", file=sys.stderr)
            return {"success": False, "error": "Failed to get attendance data"}
        
        print(f"[API] Got HTML content ({len(html_content)} characters)", file=sys.stderr)
        attendance_data = extract_attendance_data_from_html(html_content)
        
        if attendance_data:
            print(f"[API] Successfully extracted {len(attendance_data)} attendance entries", file=sys.stderr)
            attendance_json = create_attendance_json(attendance_data)
            return {
                "success": True,
                "data": attendance_json,
                "type": "attendance",
                "count": len(attendance_data),
                "cached": False
            }
        else:
            print("[API] No attendance data extracted", file=sys.stderr)
            return {
                "success": True,
                "data": {"all_subjects": [], "summary": {"total_subjects": 0}},
                "type": "attendance",
                "count": 0,
                "cached": False
            }
        
    except Exception as e:
        print(f"[API] Error getting attendance data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
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
        elif action == 'get_attendance_data':
            result = api_get_attendance_data(email, password)
        else:
            result = {"success": False, "error": "Unknown action"}
        
        # Output result as JSON (only once)
        print(json.dumps(result))
        sys.exit(0)
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

