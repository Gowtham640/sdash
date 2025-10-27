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
from timetable_scraper import api_get_timetable_data, get_timetable_page_html, extract_timetable_data_from_html, create_do_timetable_json
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
        time.sleep(0.5)  # Reduced from 2s to 0.5s - just wait for basic page structure
        
        print(f"[OK] Current URL: {scraper.driver.current_url}", file=sys.stderr)
        print(f"[OK] Page title: {scraper.driver.title}", file=sys.stderr)
        
        # Skip document.readyState wait - we disabled images, so basic structure loads quickly
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


def extract_semester_from_html(html_content):
    """
    Extract semester information from attendance page HTML
    Looks specifically in the second table for semester information
    """
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Find all tables on the page
        tables = soup.find_all('table')
        print(f"[SEMESTER] Found {len(tables)} tables on the page", file=sys.stderr)
        
        # Focus on the second table (index 1) as the user specified
        if len(tables) >= 2:
            second_table = tables[1]
            print("[SEMESTER] ✓ Targeting second table (Student Info)", file=sys.stderr)
            
            # Get all rows in the second table
            rows = second_table.find_all('tr')
            print(f"[SEMESTER] Found {len(rows)} rows in second table", file=sys.stderr)
            
            # Look through each row for "Semester:"
            for i, row in enumerate(rows):
                cells = row.find_all(['td', 'th'])
                
                # Check each cell in the row
                for j, cell in enumerate(cells):
                    cell_text = cell.get_text(strip=True)
                    
                    # If this cell contains "Semester:"
                    if 'semester' in cell_text.lower() and ':' in cell_text:
                        print(f"[SEMESTER] Found 'Semester:' in row {i}, cell {j}: '{cell_text}'", file=sys.stderr)
                        
                        # The semester NUMBER is in the NEXT cell (j+1)
                        if j + 1 < len(cells):
                            next_cell = cells[j + 1]
                            semester_text = next_cell.get_text(strip=True)
                            
                            print(f"[SEMESTER] Next cell content: '{semester_text}'", file=sys.stderr)
                            
                            # Extract number from the cell (handle <strong>3</strong> or just "3")
                            semester_match = re.search(r'(\d)', semester_text)
                            if semester_match:
                                semester = int(semester_match.group(1))
                                if 1 <= semester <= 8:
                                    print(f"[SEMESTER] ✓✓✓ Extracted semester: {semester}", file=sys.stderr)
                                    return semester
                        else:
                            print(f"[SEMESTER] No next cell found (j={j}, total cells={len(cells)})", file=sys.stderr)
        
        # Fallback: try the second table's text directly for semester info
        if len(tables) >= 2:
            second_table_text = tables[1].get_text().lower()
            semester_match = re.search(r'semester\s*:?\s*(\d)', second_table_text)
            if semester_match:
                semester = int(semester_match.group(1))
                if 1 <= semester <= 8:
                    print(f"[SEMESTER] Found in second table text: {semester}", file=sys.stderr)
                    return semester
        
        # Last resort: check all tables
        print("[SEMESTER] Checking all tables for semester info", file=sys.stderr)
        for i, table in enumerate(tables):
            table_text = table.get_text().lower()
            if 'semester' in table_text:
                semester_match = re.search(r'semester\s*:?\s*(\d)', table_text)
                if semester_match:
                    semester = int(semester_match.group(1))
                    if 1 <= semester <= 8:
                        print(f"[SEMESTER] Found in table {i}: {semester}", file=sys.stderr)
                        return semester
        
        print("[SEMESTER] No semester info found, defaulting to 1", file=sys.stderr)
        return 1  # Default to semester 1
        
    except Exception as e:
        print(f"[SEMESTER] Error extracting semester: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 1  # Default to semester 1


def create_attendance_json(attendance_data, semester=1):
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
            "semester": semester,
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
        
        # Extract semester from HTML
        semester = extract_semester_from_html(html_content)
        print(f"[API] Extracted semester: {semester}", file=sys.stderr)
        
        if attendance_data:
            print(f"[API] Successfully extracted {len(attendance_data)} attendance entries", file=sys.stderr)
            attendance_json = create_attendance_json(attendance_data, semester)
            return {
                "success": True,
                "data": attendance_json,
                "type": "attendance",
                "count": len(attendance_data),
                "semester": semester,
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


def get_marks_page_html(scraper):
    """Get the HTML content of the marks page (which is actually the attendance page)"""
    try:
        print("\n=== NAVIGATING TO MARKS PAGE (ATTENDANCE PAGE) ===", file=sys.stderr)
        
        # Navigate to the attendance page (where marks data is actually located)
        attendance_url = "https://academia.srmist.edu.in/#Page:My_Attendance"
        print(f"[MARKS] Navigating to: {attendance_url}", file=sys.stderr)
        
        scraper.driver.get(attendance_url)
        time.sleep(2)  # Wait for page to load
        
        print(f"[MARKS] Current URL: {scraper.driver.current_url}", file=sys.stderr)
        print(f"[MARKS] Page title: {scraper.driver.title}", file=sys.stderr)
        
        # Get page source
        page_source = scraper.driver.page_source
        page_length = len(page_source)
        print(f"[MARKS] Page source length: {page_length} characters", file=sys.stderr)
        
        # Check if we got valid content
        if page_source and page_length > 2000:
            print(f"[MARKS] ✓ Got attendance page with marks data", file=sys.stderr)
            return page_source
        else:
            print(f"[MARKS] ✗ Page too small or empty: {page_length} bytes", file=sys.stderr)
            return None
        
    except Exception as e:
        print(f"[MARKS] ✗ Error getting marks page: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return None


def extract_course_titles_from_html(html_content):
    """Extract course titles from the attendance table"""
    course_titles = {}
    
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Find all tables
        tables = soup.find_all('table')
        
        # Look for the attendance table (first table with course titles)
        for table in tables:
            table_text = table.get_text()
            # Look for attendance-related keywords or course title header
            if any(keyword in table_text for keyword in ['Course Title', 'Attn %', 'Hours Conducted', 'Hours Absent', 'Faculty Name']):
                print("Found attendance table with course titles", file=sys.stderr)
                
                # Process rows in attendance table
                rows = table.find_all('tr')
                for row in rows:
                    cells = row.find_all('td')
                    if len(cells) >= 3:
                        # Skip header row
                        if 'Course Code' in str(cells[0]):
                            continue
                            
                        # First cell contains course code, second cell contains course title
                        course_code_cell = cells[0]
                        course_title_cell = cells[1]
                        
                        # Extract course code
                        course_code_text = course_code_cell.get_text(strip=True)
                        course_code_match = re.search(r'(\d{2}[A-Z]{3}\d{3}[A-Z])', course_code_text)
                        
                        if course_code_match:
                            course_code = course_code_match.group(1)
                            course_title = course_title_cell.get_text(strip=True)
                            
                            # Clean up course title (remove extra whitespace, newlines)
                            course_title = ' '.join(course_title.split())
                            
                            # Skip if course title is empty or just whitespace
                            if course_title and course_title.strip():
                                # Only add if not already present (prevent overwriting correct titles)
                                if course_code not in course_titles:
                                    course_titles[course_code] = course_title
                                    print(f"[TITLE] {course_code}: {course_title}", file=sys.stderr)
                                else:
                                    print(f"[SKIP] {course_code}: Already have title '{course_titles[course_code]}', skipping '{course_title}'", file=sys.stderr)
                
                break
        
        print(f"Extracted {len(course_titles)} course titles", file=sys.stderr)
        
    except Exception as e:
        print(f"Error extracting course titles: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
    
    return course_titles


def extract_marks_data_from_html(html_content, course_titles=None):
    """
    Extract marks data from HTML content using the old working logic.
    """
    marks_data = []
    
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Check if page shows access denied
        page_text = soup.get_text().lower()
        if 'not accessible' in page_text or 'not allowed to access' in page_text:
            print("[MARKS EXTRACT] Access denied to marks page", file=sys.stderr)
            return marks_data
        
        print(f"[MARKS EXTRACT] Starting extraction from {len(html_content)} characters", file=sys.stderr)
        
        # Find all tables
        tables = soup.find_all('table')
        print(f"[MARKS EXTRACT] Found {len(tables)} tables on page", file=sys.stderr)
        
        # Process each table
        for table_idx, table in enumerate(tables):
            rows = table.find_all('tr')
            print(f"[MARKS EXTRACT] Table {table_idx}: {len(rows)} rows", file=sys.stderr)
            
            # Process each row (skip header rows)
            for i, row in enumerate(rows):
                cells = row.find_all('td')
                
                # Skip header row
                if i == 0:
                    print(f"[DEBUG] Skipping header row {i}", file=sys.stderr)
                    continue
                
                # Skip rows with insufficient cells, but try different cell arrangements
                if len(cells) < 2:
                    print(f"[DEBUG] Skipping row {i}: insufficient cells ({len(cells)})", file=sys.stderr)
                    continue
                
                # Try different cell arrangements for assessments
                assessments_cell = None
                if len(cells) >= 3:
                    assessments_cell = cells[2]  # Standard: Course, Type, Assessments
                elif len(cells) >= 4:
                    assessments_cell = cells[3]  # Alternative: Course, Type, Other, Assessments
                elif len(cells) >= 5:
                    assessments_cell = cells[4]  # Another alternative
                else:
                    # Try to find any cell that contains assessment patterns
                    for cell_idx, cell in enumerate(cells):
                        cell_text = cell.get_text(strip=True)
                        if any(pattern in cell_text for pattern in ['FT-', 'FP-', 'LLJ-', '/15.00', '/10.00']):
                            assessments_cell = cell
                            print(f"[DEBUG] Found assessments in cell {cell_idx}", file=sys.stderr)
                            break
                
                if not assessments_cell:
                    print(f"[DEBUG] Skipping row {i}: no assessment cell found", file=sys.stderr)
                    continue
                
                # Debug: Show row structure
                row_text = row.get_text(strip=True)
                if len(row_text) > 0:
                    print(f"[DEBUG] Row {i} preview: '{row_text[:50]}...'", file=sys.stderr)
                
                try:
                    # Extract course code and subject type from first two cells
                    course_code_cell = cells[0]
                    subject_type_cell = cells[1] if len(cells) > 1 else None
                    
                    # Debug: Print what's in each cell
                    print(f"\n[DEBUG] Row {i}:", file=sys.stderr)
                    print(f"  Cell 0 (Course): '{course_code_cell.get_text(strip=True)}'", file=sys.stderr)
                    print(f"  Cell 1 (Type): '{subject_type_cell.get_text(strip=True) if subject_type_cell else 'N/A'}'", file=sys.stderr)
                    print(f"  Assessments Cell: '{assessments_cell.get_text(strip=True)[:100]}...'", file=sys.stderr)
                    
                    # Extract course code using regex from the full text (handles "Regular" suffix)
                    course_code_text = course_code_cell.get_text(strip=True)
                    course_code_match = re.search(r'(\d{2}[A-Z]{3}\d{3}[A-Z])', course_code_text)
                    if not course_code_match:
                        print(f"  [SKIP] No valid course code found in: '{course_code_text}'", file=sys.stderr)
                        continue
                    
                    course_code = course_code_match.group(1)
                    subject_type = subject_type_cell.get_text(strip=True) if subject_type_cell else "Unknown"
                    
                    # Get course title from the course_titles dictionary
                    course_title = course_titles.get(course_code, "Unknown Course Title") if course_titles else "Unknown Course Title"
                    
                    # Debug: Show what's in the course_titles dictionary
                    print(f"  [DEBUG] Course titles dict has {len(course_titles) if course_titles else 0} entries", file=sys.stderr)
                    print(f"  [DEBUG] Looking for course_code: '{course_code}'", file=sys.stderr)
                    print(f"  [DEBUG] Found course_title: '{course_title}'", file=sys.stderr)
                    
                    print(f"  [OK] Processing course: {course_code} - {course_title} ({subject_type})", file=sys.stderr)
                    
                    # Extract assessments from the third cell
                    assessments = []
                    
                    # Method 1: Look for nested table in the assessments cell
                    nested_table = assessments_cell.find('table')
                    if nested_table:
                        print(f"  [DEBUG] Found nested table with {len(nested_table.find_all('tr'))} rows", file=sys.stderr)
                        # Process nested table rows
                        nested_rows = nested_table.find_all('tr')
                        for nested_row in nested_rows:
                            nested_cells = nested_row.find_all('td')
                            
                            for cell in nested_cells:
                                # Get the font element which contains the assessment data
                                font_element = cell.find('font')
                                if font_element:
                                    # Extract the strong element (assessment name/total) and the text after <br>
                                    strong_element = font_element.find('strong')
                                    if strong_element:
                                        assessment_info = strong_element.get_text(strip=True)  # e.g., "FT-II/15.00"
                                        
                                        # Get the text after <br> tag (marks obtained)
                                        br_tag = font_element.find('br')
                                        if br_tag:
                                            # Get the text that comes after the <br> tag
                                            marks_obtained = br_tag.next_sibling
                                            if marks_obtained:
                                                marks_obtained = str(marks_obtained).strip()
                                            else:
                                                # Alternative: get all text and split by line breaks
                                                all_text = font_element.get_text(strip=True)
                                                lines = all_text.split('\n')
                                                if len(lines) >= 2:
                                                    marks_obtained = lines[1].strip()
                                                else:
                                                    continue
                                        else:
                                            continue
                                        
                                        # Parse assessment info
                                        if '/' in assessment_info:
                                            assessment_name, total_marks = assessment_info.split('/', 1)
                                            assessment_name = assessment_name.strip()
                                            total_marks = total_marks.strip()
                                            
                                            # Format marks to 2 decimal places
                                            try:
                                                total_marks_float = float(total_marks)
                                                marks_obtained_float = float(marks_obtained)
                                                total_marks = f"{total_marks_float:.2f}"
                                                marks_obtained = f"{marks_obtained_float:.2f}"
                                            except ValueError:
                                                # If conversion fails, keep original values
                                                pass
                                            
                                            assessments.append({
                                                'assessment_name': assessment_name,
                                                'total_marks': total_marks,
                                                'marks_obtained': marks_obtained,
                                                'percentage': calculate_percentage(marks_obtained, total_marks)
                                            })
                                            print(f"    [OK] Found assessment: {assessment_name} = {marks_obtained}/{total_marks}", file=sys.stderr)
                    
                    # Method 2: If no nested table found, try to extract from cell text directly
                    if not assessments:
                        cell_text = assessments_cell.get_text(strip=True)
                        print(f"  [DEBUG] No nested table, trying direct text extraction: '{cell_text[:200]}...'", file=sys.stderr)
                        
                        # Multiple assessment patterns to try
                        assessment_patterns = [
                            r'([A-Z]+-[IVX]+)/(\d+\.?\d*)\s+(\d+\.?\d*)',  # FT-II/15.00 13.50
                            r'([A-Z]+-[IVX]+)/(\d+\.?\d*)\n(\d+\.?\d*)',   # FT-II/15.00\n13.50
                            r'([A-Z]+-[IVX]+)/(\d+\.?\d*).*?(\d+\.?\d*)',  # More flexible
                        ]
                        
                        for pattern_idx, pattern in enumerate(assessment_patterns):
                            matches = re.findall(pattern, cell_text)
                            print(f"  [DEBUG] Pattern {pattern_idx + 1} matches: {matches}", file=sys.stderr)
                            if matches:
                                for match in matches:
                                    assessment_name, total_marks, marks_obtained = match
                                    
                                    # Format marks to 2 decimal places
                                    try:
                                        total_marks_float = float(total_marks)
                                        marks_obtained_float = float(marks_obtained)
                                        total_marks = f"{total_marks_float:.2f}"
                                        marks_obtained = f"{marks_obtained_float:.2f}"
                                    except ValueError:
                                        pass
                                    
                                    assessments.append({
                                        'assessment_name': assessment_name,
                                        'total_marks': total_marks,
                                        'marks_obtained': marks_obtained,
                                        'percentage': calculate_percentage(marks_obtained, total_marks)
                                    })
                                    print(f"  [OK] Found assessment: {assessment_name} = {marks_obtained}/{total_marks}", file=sys.stderr)
                                break
                    
                    # Method 3: Look for any text that contains assessment-like patterns
                    if not assessments:
                        cell_text = assessments_cell.get_text(strip=True)
                        print(f"  [DEBUG] Trying fallback pattern matching...", file=sys.stderr)
                        
                        # Look for any pattern that looks like assessments
                        fallback_patterns = [
                            r'([A-Z]{2,}-[IVX]+)/(\d+\.?\d*)',  # Any assessment pattern
                            r'(\w+)/(\d+\.?\d*)',               # Any word/number pattern
                        ]
                        
                        for pattern in fallback_patterns:
                            matches = re.findall(pattern, cell_text)
                            if matches:
                                print(f"  [DEBUG] Fallback pattern found: {matches}", file=sys.stderr)
                                # Try to find corresponding marks
                                for match in matches:
                                    assessment_name, total_marks = match
                                    # Look for marks near this assessment
                                    marks_pattern = rf'{re.escape(assessment_name)}/{re.escape(total_marks)}.*?(\d+\.?\d*)'
                                    marks_match = re.search(marks_pattern, cell_text)
                                    if marks_match:
                                        marks_obtained = marks_match.group(1)
                                        
                                        # Format marks to 2 decimal places
                                        try:
                                            total_marks_float = float(total_marks)
                                            marks_obtained_float = float(marks_obtained)
                                            total_marks = f"{total_marks_float:.2f}"
                                            marks_obtained = f"{marks_obtained_float:.2f}"
                                        except ValueError:
                                            pass
                                        
                                        assessments.append({
                                            'assessment_name': assessment_name,
                                            'total_marks': total_marks,
                                            'marks_obtained': marks_obtained,
                                            'percentage': calculate_percentage(marks_obtained, total_marks)
                                        })
                                        print(f"  [OK] Fallback found: {assessment_name} = {marks_obtained}/{total_marks}", file=sys.stderr)
                                break
                    
                    if assessments:
                        marks_entry = {
                            'course_code': course_code,
                            'course_title': course_title,
                            'subject_type': subject_type,
                            'assessments': assessments,
                            'total_assessments': len(assessments)
                        }
                        
                        marks_data.append(marks_entry)
                        print(f"  [SUCCESS] {course_code}: {len(assessments)} assessments found", file=sys.stderr)
                    else:
                        print(f"  [WARN] {course_code}: No assessments found", file=sys.stderr)
                    
                except Exception as e:
                    print(f"[ERROR] Error processing row {i}: {e}", file=sys.stderr)
                    import traceback
                    traceback.print_exc(file=sys.stderr)
                    continue
    
    except Exception as e:
        print(f"[MARKS EXTRACT] Error extracting marks data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
    
    return marks_data


def calculate_percentage(obtained, total):
    """Calculate percentage from obtained and total marks, both formatted to 2 decimal places"""
    try:
        obtained_float = float(obtained)
        total_float = float(total)
        if total_float > 0:
            percentage = (obtained_float / total_float) * 100
            return f"{percentage:.2f}%"
        return "0.00%"
    except:
        return "N/A"


def create_marks_json(marks_data):
    """Create JSON structure with marks data"""
    
    # Calculate summary statistics
    total_courses = len(marks_data)
    total_assessments = sum(entry['total_assessments'] for entry in marks_data)
    
    # Group by subject type
    theory_courses = [entry for entry in marks_data if entry['subject_type'].lower() == 'theory']
    lab_courses = [entry for entry in marks_data if entry['subject_type'].lower() == 'lab']
    other_courses = [entry for entry in marks_data if entry['subject_type'].lower() not in ['theory', 'lab']]
    
    # Create the complete JSON structure
    marks_json = {
        "metadata": {
            "generated_at": datetime.now().isoformat(),
            "source": "SRM Academia Portal - Internal Marks",
            "academic_year": "2025-26 ODD",
            "institution": "SRM Institute of Science and Technology",
            "college": "College of Engineering and Technology",
            "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        },
        "summary": {
            "total_courses": total_courses,
            "theory_courses": len(theory_courses),
            "lab_courses": len(lab_courses),
            "other_courses": len(other_courses),
            "total_assessments": total_assessments
        },
        "courses": {
            "theory": theory_courses,
            "lab": lab_courses,
            "other": other_courses
        },
        "all_courses": marks_data
    }
    
    return marks_json


def api_get_marks_data(email, password):
    """API function to get marks data with session management"""
    scraper = None
    try:
        print(f"[API] Getting marks data for: {email}", file=sys.stderr)
        
        # Initialize scraper with session management
        scraper = SRMAcademiaScraperSelenium(headless=True, use_session=True)
        
        html_content = None
        # Try to get data with existing session first
        if scraper.is_session_valid():
            print("[API] Valid session found - trying to get data without login", file=sys.stderr)
            html_content = get_marks_page_html(scraper)
        
        # If session was invalid or data fetch failed, attempt login
        if html_content is None:
            print("[API] Session invalid or expired - attempting login", file=sys.stderr)
            if not scraper.login(email, password):
                print("[API] Login failed!", file=sys.stderr)
                return {"success": False, "error": "Login failed"}
            print("[API] Login successful!", file=sys.stderr)
            html_content = get_marks_page_html(scraper)

        if not html_content:
            print("[API] Failed to get marks HTML content after all attempts", file=sys.stderr)
            return {"success": False, "error": "Failed to get marks data"}
        
        print(f"[API] Got HTML content ({len(html_content)} characters)", file=sys.stderr)
        
        # Extract course titles first
        print("[API] Extracting course titles...", file=sys.stderr)
        course_titles = extract_course_titles_from_html(html_content)
        
        # Extract marks data with course titles
        print("[API] Extracting marks data...", file=sys.stderr)
        marks_data = extract_marks_data_from_html(html_content, course_titles)
        
        if marks_data:
            print(f"[API] Successfully extracted {len(marks_data)} marks entries", file=sys.stderr)
            marks_json = create_marks_json(marks_data)
            return {
                "success": True,
                "data": marks_json,
                "type": "marks",
                "count": len(marks_data),
                "cached": False
            }
        else:
            print("[API] No marks data extracted", file=sys.stderr)
            empty_marks_json = {
                "metadata": {
                    "generated_at": datetime.now().isoformat(),
                    "source": "SRM Academia Portal - Internal Marks",
                    "academic_year": "2025-26 ODD",
                    "institution": "SRM Institute of Science and Technology",
                    "college": "College of Engineering and Technology",
                    "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                },
                "summary": {
                    "total_courses": 0,
                    "theory_courses": 0,
                    "lab_courses": 0,
                    "other_courses": 0,
                    "total_assessments": 0
                },
                "courses": {
                    "theory": [],
                    "lab": [],
                    "other": []
                },
                "all_courses": []
            }
            return {
                "success": True,
                "data": empty_marks_json,
                "type": "marks",
                "count": 0,
                "cached": False
            }
        
    except Exception as e:
        print(f"[API] Error getting marks data: {e}", file=sys.stderr)
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


def get_calendar_data_with_scraper(scraper, email, password, force_refresh=False):
    """Get calendar data using existing scraper instance"""
    try:
        print(f"[UNIFIED API] Getting calendar data for: {email}", file=sys.stderr)

        # Check cache first (unless force refresh)
        if not force_refresh and is_cache_valid():
            cached_data = get_cached_calendar_data()
            if cached_data:
                print(f"[UNIFIED API] Using cached calendar data ({len(cached_data)} entries)", file=sys.stderr)
                return {
                    "success": True,
                    "data": cached_data,
                    "type": "calendar",
                    "count": len(cached_data),
                    "cached": True,
                    "cache_timestamp": datetime.now().isoformat()
                }

        print("[UNIFIED API] Cache expired or empty - fetching fresh calendar data", file=sys.stderr)

        html_content = None
        # Try to get data with existing session first
        if scraper.is_session_valid():
            print("[UNIFIED API] Valid session found - trying to get calendar data without login", file=sys.stderr)
            html_content = scraper.get_calendar_data()

        # If session was invalid or data fetch failed, attempt login
        if html_content is None:
            print("[UNIFIED API] Session invalid or expired - attempting login for calendar", file=sys.stderr)
            if not scraper.login(email, password):
                print("[UNIFIED API] Login failed for calendar!", file=sys.stderr)
                return {"success": False, "error": "Login failed"}
            print("[UNIFIED API] Login successful for calendar!", file=sys.stderr)
            html_content = scraper.get_calendar_data()

        if not html_content:
            print("[UNIFIED API] Failed to get calendar HTML content after all attempts", file=sys.stderr)
            return {"success": False, "error": "Failed to get calendar data"}

        print(f"[UNIFIED API] Got calendar HTML content ({len(html_content)} characters)", file=sys.stderr)
        calendar_data = extract_calendar_data_from_html(html_content)

        if calendar_data:
            print(f"[UNIFIED API] Successfully extracted {len(calendar_data)} calendar entries", file=sys.stderr)
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
            print("[UNIFIED API] No calendar data extracted", file=sys.stderr)
            return {
                "success": True,
                "data": [],
                "type": "calendar",
                "count": 0,
                "cached": False
            }
        
    except Exception as e:
        print(f"[UNIFIED API] Error getting calendar data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)

        if not force_refresh:
            cached_data = get_cached_calendar_data()
            if cached_data:
                print("[UNIFIED API] Scraping failed, using stale cache as fallback", file=sys.stderr)
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


def get_attendance_and_marks_data_with_scraper(scraper, email, password):
    """Get both attendance and marks data from the same page (using individual function logic)"""
    try:
        print(f"[UNIFIED API] Getting attendance and marks data for: {email}", file=sys.stderr)
        
        # Use the EXACT same logic as individual functions - fetch page once, extract both
        html_content = None
        if scraper.is_session_valid():
            print("[UNIFIED API] Valid session found - trying to get data without login", file=sys.stderr)
            # Use get_marks_page_html for proper validation (same as individual function)
            html_content = get_marks_page_html(scraper)
        
        if html_content is None:
            print("[UNIFIED API] Session invalid or expired - attempting login", file=sys.stderr)
            if not scraper.login(email, password):
                print("[UNIFIED API] Login failed!", file=sys.stderr)
                return {
                    "attendance": {"success": False, "error": "Login failed"},
                    "marks": {"success": False, "error": "Login failed"}
                }
            print("[UNIFIED API] Login successful!", file=sys.stderr)
            # Use get_marks_page_html for proper validation (same as individual function)
            html_content = get_marks_page_html(scraper)

        if not html_content:
            print("[UNIFIED API] Failed to get HTML content after all attempts", file=sys.stderr)
            return {
                "attendance": {"success": False, "error": "Failed to get data"},
                "marks": {"success": False, "error": "Failed to get data"}
            }
        
        print(f"[UNIFIED API] Got HTML content ({len(html_content)} characters)", file=sys.stderr)
        
        # Extract attendance data (same as individual function)
        print("[UNIFIED API] Extracting attendance data...", file=sys.stderr)
        attendance_data = extract_attendance_data_from_html(html_content)
        
        # Extract semester from HTML
        semester = extract_semester_from_html(html_content)
        print(f"[UNIFIED API] Extracted semester: {semester}", file=sys.stderr)
        
        if attendance_data:
            print(f"[UNIFIED API] Successfully extracted {len(attendance_data)} attendance entries", file=sys.stderr)
            attendance_json = create_attendance_json(attendance_data, semester)
            attendance_result = {
                "success": True,
                "data": attendance_json,
                "type": "attendance",
                "count": len(attendance_data),
                "semester": semester,
                "cached": False
            }
        else:
            print("[UNIFIED API] No attendance data extracted", file=sys.stderr)
            attendance_result = {
                "success": True,
                "data": {"all_subjects": [], "summary": {"total_subjects": 0}},
                "type": "attendance",
                "count": 0,
                "cached": False
            }
        
        # Extract marks data (same as individual function) - USE THE SAME HTML BUT WITH PROPER VALIDATION
        print("[UNIFIED API] Extracting marks data...", file=sys.stderr)
        
        # Extract course titles first (same as individual function)
        print("[UNIFIED API] Extracting course titles...", file=sys.stderr)
        course_titles = extract_course_titles_from_html(html_content)
        
        # Extract marks data with course titles (same as individual function)
        marks_data = extract_marks_data_from_html(html_content, course_titles)
        
        if marks_data:
            print(f"[UNIFIED API] Successfully extracted {len(marks_data)} marks entries", file=sys.stderr)
            marks_json = create_marks_json(marks_data)
            marks_result = {
                "success": True,
                "data": marks_json,
                "type": "marks",
                "count": len(marks_data),
                "cached": False
            }
        else:
            print("[UNIFIED API] No marks data extracted", file=sys.stderr)
            empty_marks_json = {
                "metadata": {
                    "generated_at": datetime.now().isoformat(),
                    "source": "SRM Academia Portal - Internal Marks",
                    "academic_year": "2025-26 ODD",
                    "institution": "SRM Institute of Science and Technology",
                    "college": "College of Engineering and Technology",
                    "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                },
                "summary": {
                    "total_courses": 0,
                    "theory_courses": 0,
                    "lab_courses": 0,
                    "other_courses": 0,
                    "total_assessments": 0
                },
                "courses": {
                    "theory": [],
                    "lab": [],
                    "other": []
                },
                "all_courses": []
            }
            marks_result = {
                "success": True,
                "data": empty_marks_json,
                "type": "marks",
                "count": 0,
                "cached": False
            }
        
        return {
            "attendance": attendance_result,
            "marks": marks_result
        }
        
    except Exception as e:
        print(f"[UNIFIED API] Exception in get_attendance_and_marks_data_with_scraper: {e}", file=sys.stderr)
        return {
            "attendance": {"success": False, "error": f"Exception: {str(e)}"},
            "marks": {"success": False, "error": f"Exception: {str(e)}"}
        }


def get_timetable_data_with_scraper(scraper, email, password):
    """Get timetable data using existing scraper instance"""
    try:
        print(f"[UNIFIED API] Getting timetable data for: {email}", file=sys.stderr)
        
        html_content = None
        # Try to get data with existing session first
        if scraper.is_session_valid():
            print("[UNIFIED API] Valid session found - trying to get timetable data without login", file=sys.stderr)
            html_content = get_timetable_page_html(scraper)
        
        # If session was invalid or data fetch failed, attempt login
        if html_content is None:
            print("[UNIFIED API] Session invalid or expired - attempting login for timetable", file=sys.stderr)
            if not scraper.login(email, password):
                print("[UNIFIED API] Login failed for timetable!", file=sys.stderr)
                return {"success": False, "error": "Login failed"}
            print("[UNIFIED API] Login successful for timetable!", file=sys.stderr)
            html_content = get_timetable_page_html(scraper)

        if not html_content:
            print("[UNIFIED API] Failed to get timetable HTML content after all attempts", file=sys.stderr)
            return {"success": False, "error": "Failed to get timetable data"}
        
        print(f"[UNIFIED API] Got timetable HTML content ({len(html_content)} characters)", file=sys.stderr)
        
        # Extract course data and batch number
        courses, batch_number = extract_timetable_data_from_html(html_content)
        
        print(f"[UNIFIED API] Extracted {len(courses) if courses else 0} courses", file=sys.stderr)
        print(f"[UNIFIED API] Batch number: {batch_number}", file=sys.stderr)
        
        if not courses:
            print("[UNIFIED API] No timetable data extracted - possible causes:", file=sys.stderr)
            print("  - No timetable assigned to student", file=sys.stderr)
            print("  - Timetable page structure changed", file=sys.stderr)
            print("  - HTML parsing failed", file=sys.stderr)
            print("  - Session expired during extraction", file=sys.stderr)
            print("[UNIFIED API] Returning proper empty timetable structure", file=sys.stderr)
            
            return {
                "success": True,
                "data": {
                    "metadata": {
                        "generated_at": datetime.now().isoformat(),
                        "source": "SRM Academia Portal",
                        "academic_year": "2025-26 ODD",
                        "format": "Day Order (DO) Timetable",
                        "batch_number": batch_number,
                        "batch_name": "No Timetable Available"
                    },
                    "time_slots": [],
                    "slot_mapping": {},
                    "timetable": {}
                },
                "type": "timetable",
                "count": 0,
                "cached": False
            }
        
        # Display batch number if found
        if batch_number:
            print(f"[UNIFIED API] Batch number detected: {batch_number}", file=sys.stderr)
        
        # Create slot mapping from courses
        from timetable_scraper import create_slot_mapping, expand_slot_mapping
        slot_mapping = create_slot_mapping(courses)
        expanded_slot_mapping = expand_slot_mapping(slot_mapping)
        
        # Create timetable JSON with proper slot mapping
        timetable_json = create_do_timetable_json(expanded_slot_mapping, batch_number)
        
        print(f"[UNIFIED API] Successfully extracted {len(courses)} timetable entries", file=sys.stderr)
        return {
            "success": True,
            "data": timetable_json,
            "type": "timetable",
            "count": len(courses),
            "cached": False
        }
        
    except Exception as e:
        print(f"[UNIFIED API] Error getting timetable data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {"success": False, "error": f"API Error: {str(e)}"}


def api_get_all_data(email, password=None, force_refresh=False):
    """
    API function to get all data types in a unified response using single browser session.
    
    Args:
        email: User email (required)
        password: User password (optional - will use existing session if not provided)
        force_refresh: Force refresh cached data
    
    Returns:
        Dict with success status and data for all types (calendar, attendance, marks, timetable)
    """
    print(f"[UNIFIED API] Getting all data for: {email} (single browser session)", file=sys.stderr)
    print(f"[UNIFIED API] Password provided: {password is not None}", file=sys.stderr)
    
    scraper = None
    try:
        # Initialize single scraper instance with per-user session
        scraper = SRMAcademiaScraperSelenium(headless=True, use_session=True, user_email=email)
        
        # Track results for each data type
        results = {}
        successful_data_types = 0
        total_data_types = 4  # calendar, attendance, marks, timetable
        
        # Check if session is valid
        session_valid = scraper.is_session_valid()
        print(f"[UNIFIED API] Session valid: {session_valid}", file=sys.stderr)
        
        # SERVERLESS-FIRST LOGIN LOGIC: Always use password if provided (Vercel has no session persistence)
        if password:
            print("[UNIFIED API] Serverless environment - attempting login with provided password", file=sys.stderr)
            if not scraper.login(email, password):
                print("[UNIFIED API] Login failed!", file=sys.stderr)
                return {"success": False, "error": "login_failed", "message": "Invalid credentials"}
            print("[UNIFIED API] Login successful!", file=sys.stderr)
        elif session_valid:
            print("[UNIFIED API] Valid session found - skipping login", file=sys.stderr)
        else:
            print("[UNIFIED API] No valid session and no password provided", file=sys.stderr)
            return {
                "success": False,
                "error": "session_expired",
                "message": "Session expired. Please re-authenticate with your password."
            }
        
        # Fetch calendar data first
        print(f"[UNIFIED API] Fetching calendar data...", file=sys.stderr)
        try:
            calendar_result = get_calendar_data_with_scraper(scraper, email, password, force_refresh)
            results['calendar'] = calendar_result
            
            if calendar_result.get('success', False):
                successful_data_types += 1
                print(f"[UNIFIED API] ✓ calendar data fetched successfully", file=sys.stderr)
            else:
                print(f"[UNIFIED API] ✗ calendar data failed: {calendar_result.get('error', 'Unknown error')}", file=sys.stderr)
                
        except Exception as e:
            print(f"[UNIFIED API] ✗ calendar data error: {e}", file=sys.stderr)
            results['calendar'] = {
                "success": False,
                "error": f"Exception: {str(e)}",
                "type": "calendar",
                "count": 0
            }
        
        # Fetch attendance and marks data together (optimized - single page fetch)
        print(f"[UNIFIED API] Fetching attendance and marks data together...", file=sys.stderr)
        try:
            combined_result = get_attendance_and_marks_data_with_scraper(scraper, email, password)
            results['attendance'] = combined_result['attendance']
            results['marks'] = combined_result['marks']
            
            # Count successful data types
            if combined_result['attendance'].get('success', False):
                successful_data_types += 1
                print(f"[UNIFIED API] ✓ attendance data fetched successfully", file=sys.stderr)
            else:
                print(f"[UNIFIED API] ✗ attendance data failed: {combined_result['attendance'].get('error', 'Unknown error')}", file=sys.stderr)
                
            if combined_result['marks'].get('success', False):
                successful_data_types += 1
                print(f"[UNIFIED API] ✓ marks data fetched successfully", file=sys.stderr)
            else:
                print(f"[UNIFIED API] ✗ marks data failed: {combined_result['marks'].get('error', 'Unknown error')}", file=sys.stderr)
                
        except Exception as e:
            print(f"[UNIFIED API] ✗ attendance/marks data error: {e}", file=sys.stderr)
            results['attendance'] = {
                "success": False,
                "error": f"Exception: {str(e)}",
                "type": "attendance",
                "count": 0
            }
            results['marks'] = {
                "success": False,
                "error": f"Exception: {str(e)}",
                "type": "marks",
                "count": 0
            }
        
        # Fetch timetable data
        print(f"[UNIFIED API] Fetching timetable data...", file=sys.stderr)
        try:
            timetable_result = get_timetable_data_with_scraper(scraper, email, password)
            results['timetable'] = timetable_result
            
            if timetable_result.get('success', False):
                data = timetable_result.get('data', {})
                print(f"[UNIFIED API] ✓ timetable data fetched successfully", file=sys.stderr)
                print(f"[UNIFIED API] Timetable data type: {type(data)}", file=sys.stderr)
                print(f"[UNIFIED API] Timetable data keys: {list(data.keys()) if isinstance(data, dict) else 'Not a dict'}", file=sys.stderr)
                if isinstance(data, dict) and 'timetable' in data:
                    print(f"[UNIFIED API] Timetable.timetable keys: {list(data['timetable'].keys())}", file=sys.stderr)
                successful_data_types += 1
            else:
                print(f"[UNIFIED API] ✗ timetable data failed: {timetable_result.get('error', 'Unknown error')}", file=sys.stderr)
                
        except Exception as e:
            print(f"[UNIFIED API] ✗ timetable data error: {e}", file=sys.stderr)
            results['timetable'] = {
                "success": False,
                "error": f"Exception: {str(e)}",
                "type": "timetable",
                "count": 0
            }
        
        # Calculate success rate
        success_rate = f"{(successful_data_types / total_data_types) * 100:.1f}%"
        
        # Determine overall success
        overall_success = successful_data_types > 0  # Success if at least one data type worked
        
        # Create unified response
        unified_response = {
            "success": overall_success,
            "data": {
                "calendar": results.get('calendar', {"success": False, "error": "Not attempted"}),
                "attendance": results.get('attendance', {"success": False, "error": "Not attempted"}),
                "marks": results.get('marks', {"success": False, "error": "Not attempted"}),
                "timetable": results.get('timetable', {"success": False, "error": "Not attempted"})
            },
            "metadata": {
                "generated_at": datetime.now().isoformat(),
                "source": "SRM Academia Portal - Unified Data (Phase 1+ Optimized)",
                "email": email,
                "total_data_types": total_data_types,
                "successful_data_types": successful_data_types,
                "success_rate": success_rate,
                "cached": False,
                "force_refresh": force_refresh,
                "single_browser_session": True,
                "optimizations": [
                    "reduced_sleep_times",
                    "combined_attendance_marks_fetch",
                    "performance_chrome_options",
                    "single_page_reuse",
                    "removed_document_ready_waits",
                    "reduced_login_wait",
                    "optimized_wait_conditions",
                    "aggressive_chrome_performance"
                ]
            }
        }
        
        # Add error field if overall success is False
        if not overall_success:
            unified_response["error"] = f"All data types failed. Success rate: {success_rate}"
        
        print(f"[UNIFIED API] Completed: {successful_data_types}/{total_data_types} data types successful ({success_rate})", file=sys.stderr)
        
        return unified_response
        
    except Exception as e:
        print(f"[UNIFIED API] Error in unified data fetch: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {"success": False, "error": f"Unified API Error: {str(e)}"}
    
    finally:
        if scraper:
            try:
                scraper.close()
                print("[UNIFIED API] Single browser session closed", file=sys.stderr)
            except Exception as e:
                print(f"[UNIFIED API] Error closing scraper: {e}", file=sys.stderr)


def api_validate_credentials(email, password):
    """
    API function to validate user credentials via portal login.
    Creates a session for the user if validation is successful.
    """
    scraper = None
    try:
        print(f"[API] Validating credentials for: {email}", file=sys.stderr)
        
        # Initialize scraper WITH session persistence so user doesn't need to log in again
        scraper = SRMAcademiaScraperSelenium(headless=True, use_session=True, user_email=email)
        
        # Attempt login (this will create/save the session)
        login_success = scraper.login(email, password)
        
        if login_success:
            print(f"[API] Credential validation successful for: {email}", file=sys.stderr)
            print(f"[API] Session created - future requests won't need password", file=sys.stderr)
            return {
                "success": True,
                "message": "Credentials validated successfully",
                "email": email,
                "session_created": True
            }
        else:
            print(f"[API] Credential validation failed for: {email}", file=sys.stderr)
            return {
                "success": False,
                "error": "Invalid credentials"
            }
        
    except Exception as e:
        print(f"[API] Error validating credentials: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {
            "success": False,
            "error": f"Validation error: {str(e)}"
        }
    
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

        # ============================================================================
        # ACTION-AWARE VALIDATION
        # ============================================================================
        # Some actions require password (for initial authentication)
        # Some actions don't require password (they use existing sessions)
        # ============================================================================

        if action == 'validate_credentials':
            # Validate credentials: REQUIRES password
            if not email or not password:
                result = {"success": False, "error": "Email and password required"}
            else:
                result = api_validate_credentials(email, password)

        elif action == 'get_all_data':
            # Get all data: email REQUIRED, password OPTIONAL (uses session if available)
            if not email:
                result = {"success": False, "error": "Email is required"}
            else:
                result = api_get_all_data(email, password, force_refresh)

        elif action == 'get_calendar_data':
            # Calendar: REQUIRES password
            if not email or not password:
                result = {"success": False, "error": "Email and password required"}
            else:
                result = api_get_calendar_data(email, password, force_refresh)

        elif action == 'get_timetable_data':
            # Timetable: REQUIRES password
            if not email or not password:
                result = {"success": False, "error": "Email and password required"}
            else:
                result = api_get_timetable_data(email, password)

        elif action == 'get_attendance_data':
            # Attendance: REQUIRES password
            if not email or not password:
                result = {"success": False, "error": "Email and password required"}
            else:
                result = api_get_attendance_data(email, password)

        elif action == 'get_marks_data':
            # Marks: REQUIRES password
            if not email or not password:
                result = {"success": False, "error": "Email and password required"}
            else:
                result = api_get_marks_data(email, password)

        else:
            result = {"success": False, "error": f"Unknown action: {action}"}
        
        # Output result as JSON (only once)
        print(json.dumps(result))
        sys.exit(0)
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

