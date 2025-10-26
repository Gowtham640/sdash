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
        
        # ✅ CRITICAL: Wait for dynamic content to load!
        print("[STEP 2] Waiting for dynamic content to load...", file=sys.stderr)
        
        # Wait for the page to be fully loaded (including JS execution)
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.common.by import By
        
        # Wait up to 15 seconds for timetable table to appear
        # Try multiple selectors to catch different table structures
        table_found = False
        selectors = [
            (By.CLASS_NAME, 'course_tbl'),
            (By.TAG_NAME, 'table'),
            (By.CSS_SELECTOR, 'table[class*="course"]'),
            (By.CSS_SELECTOR, 'table[class*="timetable"]'),
        ]
        
        for by, selector in selectors:
            try:
                print(f"[DEBUG] Waiting for table with selector: {selector}", file=sys.stderr)
                WebDriverWait(scraper.driver, 5).until(
                    EC.presence_of_element_located((by, selector))
                )
                print(f"[OK] Table found with selector: {selector}", file=sys.stderr)
                table_found = True
                break
            except:
                print(f"[DEBUG] No table found with selector: {selector}", file=sys.stderr)
                continue
        
        if not table_found:
            print("[WARN] No table found with any selector, continuing anyway...", file=sys.stderr)
        
        # Extra wait for JavaScript rendering
        time.sleep(2)  # Give it 2 seconds for full rendering
        print("[OK] Waited for JS rendering", file=sys.stderr)
        
        print(f"[OK] Current URL: {scraper.driver.current_url}", file=sys.stderr)
        print(f"[OK] Page title: {scraper.driver.title}", file=sys.stderr)
        print("[OK] Timetable page loaded successfully", file=sys.stderr)
        
        # Get page source AFTER dynamic content loads
        page_source = scraper.driver.page_source
        print(f"[OK] Page source length: {len(page_source)} characters", file=sys.stderr)
        
        return page_source
        
    except Exception as e:
        print(f"[FAIL] Error getting timetable page: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
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
    Uses flexible table finding logic like the old working code.
    """
    courses = []
    batch_number = None
    
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # First, try to extract batch number
        batch_number = extract_batch_number_from_html(html_content)
        
        # Find ALL tables and debug what we have
        tables = soup.find_all('table')
        print(f"[TIMETABLE] Found {len(tables)} tables on the page", file=sys.stderr)
        
        # Debug each table to see what we're working with
        for i, table in enumerate(tables):
            classes = table.get('class', [])
            rows = table.find_all('tr')
            print(f"[TIMETABLE] Table {i}: classes={classes}, rows={len(rows)}", file=sys.stderr)
            
            # Show first few rows for debugging
            if len(rows) > 0:
                first_row_cells = rows[0].find_all(['td', 'th'])
                first_row_text = [cell.get_text(strip=True)[:50] for cell in first_row_cells]
                print(f"[TIMETABLE] Table {i} first row: {first_row_text}", file=sys.stderr)
        
        # Try multiple approaches to find the course table (like old working code)
        course_table = None
        
        # Approach 1: Look for course_tbl class (original approach)
        course_table = soup.find('table', class_='course_tbl')
        if course_table:
            print("[TIMETABLE] Found table with class 'course_tbl'", file=sys.stderr)
        else:
            print("[TIMETABLE] No table with class 'course_tbl' found", file=sys.stderr)
        
        # Approach 2: Look for any table with course-like content (flexible approach)
        if not course_table:
            for i, table in enumerate(tables):
                rows = table.find_all('tr')
                if len(rows) > 1:  # More than just header
                    # Check if this table has course-like content
                    table_text = table.get_text().lower()
                    if any(keyword in table_text for keyword in ['course', 'subject', 'slot', 'theory', 'practical']):
                        print(f"[TIMETABLE] Found potential course table {i} with course-like content", file=sys.stderr)
                        course_table = table
                        break
        
        # Approach 3: Look for any table with enough columns (fallback)
        if not course_table:
            for i, table in enumerate(tables):
                rows = table.find_all('tr')
                if len(rows) > 1:  # More than just header
                    # Check if any row has enough cells (course tables usually have many columns)
                    for row in rows:
                        cells = row.find_all(['td', 'th'])
                        if len(cells) >= 6:  # Course tables typically have many columns
                            print(f"[TIMETABLE] Found table {i} with sufficient columns ({len(cells)})", file=sys.stderr)
                            course_table = table
                            break
                    if course_table:
                        break
        
        # Extract courses from the found table
        if course_table:
            print("[TIMETABLE] Extracting courses from found table", file=sys.stderr)
            courses = extract_from_table(course_table)
        else:
            print("[TIMETABLE] No suitable course table found", file=sys.stderr)
            # Try extracting from ALL tables as last resort
            for i, table in enumerate(tables):
                rows = table.find_all('tr')
                if len(rows) > 1:  # More than just header
                    print(f"[TIMETABLE] Trying to extract from table {i} as last resort...", file=sys.stderr)
                    courses = extract_from_table(table)
                    if courses:
                        print(f"[TIMETABLE] Successfully extracted {len(courses)} courses from table {i}", file=sys.stderr)
                        break
        
        print(f"[TIMETABLE] Final result: {len(courses)} course entries extracted", file=sys.stderr)
        
        # Add batch number to each course entry
        if batch_number:
            for course in courses:
                course['batch_number'] = batch_number
    
    except Exception as e:
        print(f"[TIMETABLE] Error extracting timetable data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
    
    return courses, batch_number

def extract_from_table(table_soup):
    """Extract course data from a BeautifulSoup table element using flexible approach"""
    courses = []
    
    try:
        rows = table_soup.find_all('tr')
        print(f"[EXTRACT] Processing table with {len(rows)} rows", file=sys.stderr)
        
        for i, row in enumerate(rows):
            cells = row.find_all(['td', 'th'])
            print(f"[EXTRACT] Row {i}: {len(cells)} cells", file=sys.stderr)
            
            if len(cells) >= 3:  # Need at least 3 cells for course data
                try:
                    # Try different cell positions for course title and slot
                    course_title = None
                    slot = None
                    
                    # Method 1: Try original positions (3rd cell for title, 9th for slot)
                    if len(cells) >= 9:
                        course_title = cells[2].get_text(strip=True)
                        slot = cells[8].get_text(strip=True)
                        print(f"[EXTRACT] Row {i} Method 1: title='{course_title}', slot='{slot}'", file=sys.stderr)
                    
                    # Method 2: Look for course-like content in any cell
                    if not course_title or not slot:
                        for j, cell in enumerate(cells):
                            cell_text = cell.get_text(strip=True)
                            # Look for course titles (longer text, not just codes)
                            if len(cell_text) > 10 and not cell_text.isdigit() and not re.match(r'^[A-Z0-9]+$', cell_text):
                                if not course_title:
                                    course_title = cell_text
                                    print(f"[EXTRACT] Row {i} Method 2: Found title '{course_title}' in cell {j}", file=sys.stderr)
                            # Look for slot codes (short alphanumeric codes)
                            elif re.match(r'^[A-Z0-9]+$', cell_text) and len(cell_text) <= 5:
                                if not slot:
                                    slot = cell_text
                                    print(f"[EXTRACT] Row {i} Method 2: Found slot '{slot}' in cell {j}", file=sys.stderr)
                    
                    # Method 3: Look for specific patterns
                    if not course_title or not slot:
                        all_text = ' '.join([cell.get_text(strip=True) for cell in cells])
                        print(f"[EXTRACT] Row {i} Method 3: All text: '{all_text[:100]}...'", file=sys.stderr)
                        
                        # Look for course title patterns
                        if not course_title:
                            # Look for text that looks like course names
                            for cell in cells:
                                cell_text = cell.get_text(strip=True)
                                if len(cell_text) > 15 and ' ' in cell_text and not cell_text.isdigit():
                                    course_title = cell_text
                                    print(f"[EXTRACT] Row {i} Method 3: Found title '{course_title}'", file=sys.stderr)
                                    break
                        
                        # Look for slot patterns
                        if not slot:
                            # Look for slot codes in the text
                            slot_match = re.search(r'\b([A-Z]\d*[A-Z]?\d*)\b', all_text)
                            if slot_match:
                                slot = slot_match.group(1)
                                print(f"[EXTRACT] Row {i} Method 3: Found slot '{slot}'", file=sys.stderr)
                    
                    # Only add if we found both course title and slot
                    if course_title and slot and len(course_title) > 3 and len(slot) > 0:
                        courses.append({
                            'row_number': i,
                            'course_title': course_title,
                            'slot': slot,
                            'all_cells': [cell.get_text(strip=True) for cell in cells]
                        })
                        print(f"[EXTRACT] ✅ Row {i}: {course_title} -> Slot {slot}", file=sys.stderr)
                    else:
                        print(f"[EXTRACT] ❌ Row {i}: Skipped - title='{course_title}', slot='{slot}'", file=sys.stderr)
                        
                except Exception as e:
                    print(f"[EXTRACT] ⚠️ Error processing row {i}: {e}", file=sys.stderr)
            else:
                print(f"[EXTRACT] Row {i}: Skipped - insufficient cells ({len(cells)})", file=sys.stderr)
    
    except Exception as e:
        print(f"[EXTRACT] ❌ Error extracting data from table: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
    
    print(f"[EXTRACT] Final result: {len(courses)} courses extracted", file=sys.stderr)
    return courses

def create_slot_mapping(courses):
    """Create a mapping from slot codes to course titles"""
    slot_mapping = []
    
    for course in courses:
        slot = course['slot']
        course_title = course['course_title']
        
        slot_mapping.append({
            'slot': slot,
            'course_title': course_title
        })
    
    return slot_mapping

def expand_slot_mapping(slot_mapping):
    """Expand P-slot ranges and create comprehensive mapping"""
    expanded_mapping = {}
    
    for entry in slot_mapping:
        slot = entry['slot']
        course_title = entry['course_title']
        
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
                        expanded_mapping[f'P{num}'] = course_title
                        print(f"[MAPPING] P{num} -> {course_title}", file=sys.stderr)
                else:
                    expanded_mapping[slot] = course_title
            else:
                expanded_mapping[slot] = course_title
        else:
            expanded_mapping[slot] = course_title
    
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
    
    # ============================================================================
    # CRITICAL FIX: Convert slot_mapping array to dictionary
    # ============================================================================
    # slot_mapping comes as an array of objects with 'slot' and 'course_title'
    # We need to convert it to a dict for lookup: {slot_code: course_title}
    # ============================================================================
    
    slot_mapping_dict = {}
    if isinstance(slot_mapping, list):
        print(f"[MAPPING] Converting array slot_mapping to dictionary", file=sys.stderr)
        for entry in slot_mapping:
            if isinstance(entry, dict) and 'slot' in entry and 'course_title' in entry:
                slot_code = entry['slot'].strip()
                course_title = entry['course_title'].strip()
                slot_mapping_dict[slot_code] = course_title
                if course_title:  # Only log non-empty courses
                    print(f"[MAPPING] Mapped {slot_code} -> {course_title}", file=sys.stderr)
    elif isinstance(slot_mapping, dict):
        # Already a dictionary, use as-is
        slot_mapping_dict = slot_mapping
        print(f"[MAPPING] slot_mapping is already a dictionary", file=sys.stderr)
    else:
        print(f"[MAPPING] Warning: slot_mapping has unexpected type: {type(slot_mapping)}", file=sys.stderr)
        slot_mapping_dict = {}
    
    print(f"[MAPPING] Converted {len(slot_mapping_dict)} slot mappings", file=sys.stderr)
    
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
    
    def map_slot_to_course(slot_code, slot_dict):
        """Map a slot code to its course title using the dictionary"""
        if not slot_code or slot_code.strip() == "":
            return ""
        
        slot_code = slot_code.strip()
        
        # Handle slots with /X (like P2/X, A/X)
        if '/X' in slot_code:
            base_slot = slot_code.replace('/X', '').strip()
            if base_slot in slot_dict:
                return slot_dict[base_slot]
            else:
                return ""
        
        # Direct mapping
        if slot_code in slot_dict:
            return slot_dict[slot_code]
        
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
                course_title = map_slot_to_course(period, slot_mapping_dict)
                
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
