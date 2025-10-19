#!/usr/bin/env python3
"""
Timetable Scraper for SRM Academia Portal
Extracts timetable data and creates JSON structure for Next.js integration
"""

import re
import sys  # ← Add this line
import time
import json
from datetime import datetime
from bs4 import BeautifulSoup
from scraper_selenium_session import SRMAcademiaScraperSelenium

def get_timetable_page_html(scraper):
    """Get the HTML content of the timetable page"""
    try:
        print("\n=== NAVIGATING TO TIMETABLE PAGE ===", file=sys.stderr)
        
        # Navigate to the timetable page
        timetable_url = "https://academia.srmist.edu.in/#Page:My_Time_Table_2023_24"
        print(f"[STEP 1] Navigating to: {timetable_url}", file=sys.stderr)
        
        scraper.driver.get(timetable_url)
        time.sleep(5)
        
        print(f"[OK] Current URL: {scraper.driver.current_url}", file=sys.stderr)
        print(f"[OK] Page title: {scraper.driver.title}", file=sys.stderr)
        
        # Wait for page to load completely
        scraper.wait.until(
            lambda driver: driver.execute_script("return document.readyState") == "complete"
        )
        
        print("[OK] Timetable page loaded successfully", file=sys.stderr)
        
        # Get page source
        page_source = scraper.driver.page_source
        
        return page_source
        
    except Exception as e:
        print(f"[FAIL] Error getting timetable page: {e}", file=sys.stderr)
        return None

def extract_timetable_data_from_html(html_content):
    """
    Extract timetable data from HTML content using BeautifulSoup.
    Based on the HTML structure: course_tbl table with course titles and slots.
    """
    courses = []
    
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Find the main course table
        course_table = soup.find('table', class_='course_tbl')
        
        if not course_table:
            print("Course table with class 'course_tbl' not found", file=sys.stderr)
            # Look for any tables as fallback
            tables = soup.find_all('table')
            print(f"Found {len(tables)} tables on the page", file=sys.stderr)
            
            for i, table in enumerate(tables):
                rows = table.find_all('tr')
                if len(rows) > 1:  # More than just header
                    print(f"Analyzing table {i} with {len(rows)} rows...", file=sys.stderr)
                    courses = extract_from_table(table)
                    if courses:
                        print(f"Found {len(courses)} courses in table {i}", file=sys.stderr)
                        break
        else:
            print("Found course table with class 'course_tbl'", file=sys.stderr)
            courses = extract_from_table(course_table)
        
        print(f"Extracted {len(courses)} course entries", file=sys.stderr)
    
    except Exception as e:
        print(f"Error extracting timetable data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
    
    return courses

def extract_from_table(table_soup):
    """Extract course data from a BeautifulSoup table element"""
    courses = []
    
    try:
        rows = table_soup.find_all('tr')
        
        for i, row in enumerate(rows):
            cells = row.find_all('td')
            if len(cells) >= 9:  # Ensure we have enough cells
                try:
                    # Course title is in 3rd cell (index 2)
                    course_title = cells[2].get_text(strip=True)
                    # Slot is in 9th cell (index 8)
                    slot = cells[8].get_text(strip=True)
                    
                    if course_title and slot:
                        courses.append({
                            'row_number': i,
                            'course_title': course_title,
                            'slot': slot,
                            'all_cells': [cell.get_text(strip=True) for cell in cells]
                        })
                        print(f"[DATA] Row {i}: {course_title} -> Slot {slot}", file=sys.stderr)
                except Exception as e:
                    print(f"[WARN] Error processing row {i}: {e}", file=sys.stderr)
    
    except Exception as e:
        print(f"[FAIL] Error extracting data from table: {e}", file=sys.stderr)
    
    return courses

def create_slot_mapping(courses):
    """Create a mapping from slot codes to course titles"""
    slot_mapping = {}
    
    for course in courses:
        slot = course['slot']
        course_title = course['course_title']
        
        if slot not in slot_mapping:
            slot_mapping[slot] = course_title
        else:
            print(f"[WARN] Slot {slot} already mapped to {slot_mapping[slot]}, new course: {course_title}", file=sys.stderr)
    
    return slot_mapping

def expand_slot_mapping(slot_mapping):
    """Expand P-slot ranges and create comprehensive mapping"""
    expanded_mapping = {}
    
    for slot, course in slot_mapping.items():
        if slot.startswith('P') and '-' in slot:
            # Handle P-slot ranges like "P3-P4-" or "P39-P40-"
            if slot.endswith('-'):
                slot = slot[:-1]  # Remove trailing dash
            
            # Parse the range
            if '-' in slot:
                parts = slot.split('-')
                if len(parts) == 2:
                    start_part = parts[0]  # P3
                    end_part = parts[1]    # P4
                    
                    # Extract numbers
                    start_num = int(re.findall(r'\d+', start_part)[0])
                    end_num = int(re.findall(r'\d+', end_part)[0])
                    
                    # Create individual slot mappings
                    for num in range(start_num, end_num + 1):
                        expanded_mapping[f'P{num}'] = course
                        print(f"[MAPPING] P{num} -> {course}", file=sys.stderr)
                else:
                    expanded_mapping[slot] = course
            else:
                expanded_mapping[slot] = course
        else:
            expanded_mapping[slot] = course
    
    return expanded_mapping

def create_do_timetable_json(slot_mapping):
    """Create JSON structure for Day Order (DO) timetable format"""
    
    # Time slots matching the frontend UI
    time_slots = [
        "08:00-08:50",
        "08:50-09:40", 
        "09:45-10:35",
        "10:40-11:30",
        "11:35-12:25",
        "12:30-01:20",
        "01:25-02:15",
        "02:20-03:10",
        "03:10-04:00",
        "04:00-04:50"
    ]
    
    # Day Order periods mapping (DO 1-5)
    # This maps each DO to the slot codes for each time period based on actual SRM timetable structure
    # Updated to use actual scraped slots
    do_periods = {
        "DO 1": ['A', 'P11', 'C', 'P31', 'E', 'P1', 'B', 'P21', 'D', 'P41'],
        "DO 2": ['A/X', 'P12/X', 'C/X', 'P32/X', 'E/X', 'P2/X', 'B/X', 'P22/X', 'D/X', 'P42/X'],
        "DO 3": ['F/X', 'P13/X', 'A/X', 'P33/X', 'C/X', 'P3/X', 'G/X', 'P23/X', 'B/X', 'P43/X'],
        "DO 4": ['F', 'P14', 'D', 'P34', 'F', 'P4', 'A', 'P24', 'E', 'P44'],
        "DO 5": ['G', 'P15', 'B', 'P35', 'D', 'P5', 'G', 'P25', 'C', 'P45']
    }
    
    # Create a more intelligent mapping based on actual scraped slots
    def create_smart_mapping(slot_mapping):
        """Create a mapping that uses actual scraped slots"""
        # Get all available slots from scraped data
        available_slots = list(slot_mapping.keys())
        print(f"[MAPPING] Available slots from scraped data: {available_slots}", file=sys.stderr)
        
        # Create a smart mapping for each DO
        smart_do_periods = {}
        
        for do_name in ["DO 1", "DO 2", "DO 3", "DO 4", "DO 5"]:
            smart_do_periods[do_name] = []
            
            # For each time slot, try to find the best matching slot
            for time_idx in range(len(time_slots)):
                # Try to find a slot that matches the expected pattern
                expected_slot = do_periods[do_name][time_idx] if time_idx < len(do_periods[do_name]) else ""
                
                # Check if the expected slot exists in scraped data
                if expected_slot in slot_mapping:
                    smart_do_periods[do_name].append(expected_slot)
                elif expected_slot.replace('/X', '') in slot_mapping:
                    # Try without /X suffix
                    smart_do_periods[do_name].append(expected_slot.replace('/X', ''))
                else:
                    # Find the best available slot for this time slot
                    # Priority: Theory slots (A-G) first, then Lab slots (P), then others
                    theory_slots = [s for s in available_slots if s in ['A', 'B', 'C', 'D', 'E', 'F', 'G']]
                    lab_slots = [s for s in available_slots if s.startswith('P')]
                    
                    if theory_slots:
                        smart_do_periods[do_name].append(theory_slots[time_idx % len(theory_slots)])
                    elif lab_slots:
                        smart_do_periods[do_name].append(lab_slots[time_idx % len(lab_slots)])
                    else:
                        smart_do_periods[do_name].append(available_slots[time_idx % len(available_slots)] if available_slots else "")
            
            print(f"[MAPPING] {do_name} mapped to: {smart_do_periods[do_name]}", file=sys.stderr)
        
        return smart_do_periods
    
    def get_slot_type(slot_code):
        """Determine the type of slot"""
        if slot_code.startswith('P'):
            return "Lab"
        elif slot_code.startswith('L'):
            return "Lab"
        elif slot_code in ['A', 'B', 'C', 'D', 'E', 'F', 'G']:
            return "Theory"
        else:
            return "Other"
    
    def map_slot_to_course(slot_code, slot_mapping):
        """Map a slot code to its course title"""
        if not slot_code or slot_code.strip() == "":
            return ""
        
        slot_code = slot_code.strip()
        
        # Handle slots with /X (like P2/X, A/X)
        if '/X' in slot_code:
            base_slot = slot_code.replace('/X', '').strip()
            if base_slot in slot_mapping:
                return slot_mapping[base_slot]
            else:
                return slot_code
        
        # Direct mapping
        if slot_code in slot_mapping:
            return slot_mapping[slot_code]
        
        # If not found, return the original slot code
        return slot_code
    
    # Create the DO timetable structure
    do_timetable = {
        "metadata": {
            "generated_at": datetime.now().isoformat(),
            "source": "SRM Academia Portal",
            "academic_year": "2025-26 ODD",
            "format": "Day Order (DO) Timetable"
        },
        "time_slots": time_slots,
        "slot_mapping": slot_mapping,
        "timetable": {}
    }
    
    # Create timetable data for each DO using smart mapping
    smart_do_periods = create_smart_mapping(slot_mapping)
    
    for do_name, periods in smart_do_periods.items():
        do_data = {
            "do_name": do_name,
            "time_slots": {}
        }
        
        for slot_idx, period in enumerate(periods):
            if slot_idx < len(time_slots):
                time_slot = time_slots[slot_idx]
                course_title = map_slot_to_course(period, slot_mapping)
                
                do_data["time_slots"][time_slot] = {
                    "slot_code": period,
                    "course_title": course_title,
                    "slot_type": get_slot_type(period),
                    "is_alternate": "/X" in period
                }
        
        do_timetable["timetable"][do_name] = do_data
    
    return do_timetable

def api_get_timetable_data(email, password, force_refresh=False):
    """API function to get timetable data"""
    scraper = None
    try:
        print(f"[API] Getting timetable data for: {email}", file=sys.stderr)
        
        # Initialize scraper with session management
        scraper = SRMAcademiaScraperSelenium(headless=True, use_session=True)
        
        html_content = None
        # Try to get data with existing session first
        if scraper.is_session_valid():
            print("[API] Valid session found - trying to get data without login", file=sys.stderr)
            html_content = get_timetable_page_html(scraper)
        
        # If session was invalid or data fetch failed, attempt login
        if html_content is None:
            print("[API] Session invalid or expired - attempting login", file=sys.stderr)
            if not scraper.login(email, password):
                print("[API] Login failed!", file=sys.stderr)
                return {"success": False, "error": "Login failed"}
            print("[API] Login successful!", file=sys.stderr)
            html_content = get_timetable_page_html(scraper)

        if not html_content:
            print("[API] Failed to get timetable HTML content after all attempts", file=sys.stderr)
            return {"success": False, "error": "Failed to get timetable data"}
        
        print(f"[API] Got HTML content ({len(html_content)} characters)", file=sys.stderr)
        
        # Extract course data
        courses = extract_timetable_data_from_html(html_content)
        
        if not courses:
            print("[API] No timetable data extracted", file=sys.stderr)
            return {
                "success": True,
                "data": [],
                "type": "timetable",
                "count": 0,
                "cached": False
            }
        
        # Create slot mapping
        slot_mapping = create_slot_mapping(courses)
        
        # Expand P-slot ranges
        expanded_slot_mapping = expand_slot_mapping(slot_mapping)
        
        # Create DO timetable JSON
        do_timetable = create_do_timetable_json(expanded_slot_mapping)
        
        print(f"[API] Successfully created DO timetable with {len(expanded_slot_mapping)} slot mappings", file=sys.stderr)
        
        return {
            "success": True,
            "data": do_timetable,
            "type": "timetable",
            "count": len(courses),
            "cached": False,
            "fresh_data": True
        }
                   
    except Exception as e:
        print(f"[API] Error getting timetable data: {e}", file=sys.stderr)
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

if __name__ == "__main__":
    import sys
    
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
        
        if action == 'get_timetable_data':
            result = api_get_timetable_data(email, password, force_refresh)
        else:
            result = {"success": False, "error": "Unknown action"}
    
        # Output result as JSON (only once)
        print(json.dumps(result))
        sys.exit(0)  # Exit immediately after outputting result
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)  # Exit immediately after outputting error
