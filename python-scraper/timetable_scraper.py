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
        time.sleep(0.5)  # Reduced from 2s to 0.5s - just wait for basic page structure
        
        print(f"[OK] Current URL: {scraper.driver.current_url}", file=sys.stderr)
        print(f"[OK] Page title: {scraper.driver.title}", file=sys.stderr)
        
        # Skip document.readyState wait - we disabled images, so basic structure loads quickly
        print("[OK] Timetable page loaded successfully", file=sys.stderr)
        
        # Get page source
        page_source = scraper.driver.page_source
        
        return page_source
        
    except Exception as e:
        print(f"[FAIL] Error getting timetable page: {e}", file=sys.stderr)
        return None

def extract_batch_number_from_html(html_content):
    """Extract batch number from the table above the course table"""
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Find all tables
        tables = soup.find_all('table')
        print(f"[BATCH] Found {len(tables)} tables on the page", file=sys.stderr)
        
        batch_number = None
        
        # Look for batch number in tables before the course table
        for i, table in enumerate(tables):
            table_text = table.get_text().lower()
            
            # Look for batch-related keywords
            if any(keyword in table_text for keyword in ['batch', 'group', 'section']):
                print(f"[BATCH] Found potential batch table {i}", file=sys.stderr)
                
                # Look for batch number patterns
                rows = table.find_all('tr')
                for row in rows:
                    cells = row.find_all(['td', 'th'])
                    for cell in cells:
                        cell_text = cell.get_text(strip=True)
                        
                        # Look for batch number patterns like "Batch 1", "Group A", etc.
                        batch_patterns = [
                            r'batch\s*(\d+)',
                            r'group\s*([a-z0-9]+)',
                            r'section\s*([a-z0-9]+)',
                            r'batch\s*([a-z0-9]+)',
                        ]
                        
                        for pattern in batch_patterns:
                            match = re.search(pattern, cell_text.lower())
                            if match:
                                batch_number = match.group(1)
                                print(f"[BATCH] Found batch number: {batch_number}", file=sys.stderr)
                                return batch_number
                
                # If no pattern match, look for any number that might be batch
                for row in rows:
                    cells = row.find_all(['td', 'th'])
                    for cell in cells:
                        cell_text = cell.get_text(strip=True)
                        # Look for single numbers that might be batch numbers
                        if cell_text.isdigit() and 1 <= int(cell_text) <= 10:
                            batch_number = cell_text
                            print(f"[BATCH] Found potential batch number: {batch_number}", file=sys.stderr)
                            return batch_number
        
        if not batch_number:
            print("[BATCH] No batch number found in tables", file=sys.stderr)
            return None
            
    except Exception as e:
        print(f"[BATCH] Error extracting batch number: {e}", file=sys.stderr)
        return None

def extract_timetable_data_from_html(html_content):
    """
    Extract timetable data from HTML content using BeautifulSoup.
    Based on the HTML structure: course_tbl table with course titles and slots.
    """
    courses = []
    batch_number = None
    
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # First, try to extract batch number
        batch_number = extract_batch_number_from_html(html_content)
        
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
        
        # Add batch number to each course entry
        if batch_number:
            for course in courses:
                course['batch_number'] = batch_number
    
    except Exception as e:
        print(f"Error extracting timetable data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
    
    return courses, batch_number

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

def create_do_timetable_json(slot_mapping, batch_number=None):
    """Create JSON structure for Day Order (DO) timetable format"""
    
    # Time slots matching the frontend UI (10 slots only)
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
    
    # Batch 1 periods
    batch_1_periods = [
        ['A', 'A/X', 'F/X', 'F', 'G', 'P6', 'P7', 'P8', 'P9', 'P10'],
        ['P11', 'P12/X', 'P13/X', 'P14', 'P15', 'B', 'B', 'G', 'G', 'A'],
        ['C', 'C/X', 'A/X', 'D', 'B', 'P26', 'P27', 'P28', 'P29', 'P30'],
        ['P31', 'P32/X', 'P33/X', 'P34', 'P35', 'D', 'D', 'B', 'E', 'C'],
        ['E', 'E/X', 'C/X', 'F', 'D', 'P46', 'P47', 'P48', 'P49', 'P50']
    ]
    
    # Batch 2 periods
    batch_2_periods = [
        ['P1', 'P2/X', 'P3/X', 'P4', 'P5', 'A', 'A', 'F', 'F', 'G'],
        ['B', 'B/X', 'G/X', 'G', 'A', 'P16', 'P17', 'P18', 'P19', 'P20'],
        ['P21', 'P22/X', 'P23/X', 'P24', 'P25', 'C', 'C', 'A', 'D', 'B'],
        ['D', 'D/X', 'B/X', 'E', 'C', 'P36', 'P37', 'P38', 'P39', 'P40'],
        ['P41', 'P42/X', 'P43/X', 'P44', 'P45', 'E', 'E', 'C', 'F', 'D']
    ]
    
    # Select the correct batch periods based on detected batch number
    if batch_number == "1" or batch_number == 1:
        selected_periods = batch_1_periods
        batch_name = "Batch 1"
        print(f"[MAPPING] Using Batch 1 periods", file=sys.stderr)
    elif batch_number == "2" or batch_number == 2:
        selected_periods = batch_2_periods
        batch_name = "Batch 2"
        print(f"[MAPPING] Using Batch 2 periods", file=sys.stderr)
    else:
        # Default to Batch 2 if batch number not detected
        selected_periods = batch_2_periods
        batch_name = "Batch 2 (Default)"
        print(f"[MAPPING] Batch number '{batch_number}' not recognized, defaulting to Batch 2", file=sys.stderr)
    
    # Convert periods to DO format
    do_periods = {}
    for i, periods in enumerate(selected_periods):
        do_name = f"DO {i + 1}"
        do_periods[do_name] = periods
        print(f"[MAPPING] {do_name}: {periods}", file=sys.stderr)
    
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
                return ""
        
        # Direct mapping
        if slot_code in slot_mapping:
            return slot_mapping[slot_code]
        
        # If not found, return empty string (no course assigned)
        return ""
    
    # Create the DO timetable structure
    do_timetable = {
        "metadata": {
            "generated_at": datetime.now().isoformat(),
            "source": "SRM Academia Portal",
            "academic_year": "2025-26 ODD",
            "format": "Day Order (DO) Timetable",
            "batch_number": batch_number,
            "batch_name": batch_name
        },
        "time_slots": time_slots,
        "slot_mapping": slot_mapping,
        "timetable": {}
    }
    
    # Create timetable data for each DO using predefined periods
    for do_idx, (do_name, periods) in enumerate(do_periods.items()):
        do_data = {
            "day_number": do_idx + 1,
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

def api_get_timetable_data(email, password):
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
        
        # Extract course data and batch number
        courses, batch_number = extract_timetable_data_from_html(html_content)
        
        if not courses:
            print("[API] No timetable data extracted", file=sys.stderr)
            return {
                "success": True,
                "data": [],
                "type": "timetable",
                "count": 0,
                "cached": False
            }
        
        # Display batch number if found
        if batch_number:
            print(f"[API] Extracted batch number: {batch_number}", file=sys.stderr)
        else:
            print("[API] No batch number found", file=sys.stderr)
        
        # Create slot mapping
        slot_mapping = create_slot_mapping(courses)
        
        # Expand P-slot ranges
        expanded_slot_mapping = expand_slot_mapping(slot_mapping)
        
        # Create DO timetable JSON with batch number
        do_timetable = create_do_timetable_json(expanded_slot_mapping, batch_number)
        
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
