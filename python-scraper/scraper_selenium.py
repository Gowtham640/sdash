from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException
import time

class SRMAcademiaScraperSelenium:
    def __init__(self, headless=False):
        """Initialize the scraper with Selenium"""
        chrome_options = Options()
        if headless:
            chrome_options.add_argument("--headless")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)
        
        try:
            self.driver = webdriver.Chrome(options=chrome_options)
            self.wait = WebDriverWait(self.driver, 20)
            print("[OK] Selenium WebDriver initialized")
        except Exception as e:
            print(f"[FAIL] Could not initialize WebDriver: {e}")
            print("[INFO] Make sure you have Chrome and chromedriver installed")
            raise
    
    def login(self, email, password):
        """Login to the academia portal using Selenium"""
        try:
            print("\n=== LOGIN WITH SELENIUM ===")
            
            # Navigate to the portal
            print("[STEP 1] Loading portal page...")
            self.driver.get("https://academia.srmist.edu.in/")
            time.sleep(3)  # Wait for page to load
            
            print(f"[OK] Page loaded: {self.driver.title}")
            
            # Switch to the iframe
            print("[STEP 2] Switching to login iframe...")
            try:
                iframe = self.wait.until(
                    EC.presence_of_element_located((By.ID, "signinFrame"))
                )
                self.driver.switch_to.frame(iframe)
                print("[OK] Switched to iframe")
            except TimeoutException:
                print("[FAIL] Could not find login iframe")
                return False
            
            # Find and fill email field
            print("[STEP 3] Entering email...")
            try:
                email_field = self.wait.until(
                    EC.presence_of_element_located((By.ID, "login_id"))
                )
                email_field.clear()
                email_field.send_keys(email)
                print(f"[OK] Email entered: {email}")
            except TimeoutException:
                print("[FAIL] Could not find email field")
                return False
            
            # Click Next button to reveal password field
            print("[STEP 4] Clicking Next button...")
            try:
                # Look for Next button (could be id="nextbtn" or other variants)
                next_button = None
                next_button_selectors = [
                    (By.ID, "nextbtn"),
                    (By.XPATH, "//button[contains(text(), 'Next')]"),
                    (By.XPATH, "//button[@type='submit']"),
                    (By.XPATH, "//input[@type='submit']"),
                ]
                
                for by, selector in next_button_selectors:
                    try:
                        next_button = self.driver.find_element(by, selector)
                        if next_button and next_button.is_displayed():
                            next_button.click()
                            print("[OK] Next button clicked")
                            time.sleep(2)  # Wait for password field to appear
                            break
                    except:
                        continue
                
                if not next_button:
                    print("[WARN] Next button not found, password field might already be visible")
                    time.sleep(1)
                    
            except Exception as e:
                print(f"[WARN] Could not click Next button: {e}")
                print("[INFO] Proceeding anyway, password field might be visible")
            
            # Find and fill password field (wait for it to become visible/interactable)
            print("[STEP 5] Entering password...")
            try:
                # Wait for password field to be visible and interactable
                password_field = self.wait.until(
                    EC.element_to_be_clickable((By.ID, "password"))
                )
                
                # Try to clear and enter password
                try:
                    password_field.clear()
                except:
                    # If clear fails, just proceed to send keys
                    pass
                
                password_field.send_keys(password)
                print("[OK] Password entered")
                time.sleep(1)
            except TimeoutException:
                print("[FAIL] Could not find password field after clicking Next")
                return False
            
            # Click sign in button
            print("[STEP 6] Clicking sign in button...")
            try:
                sign_in_button = self.wait.until(
                    EC.element_to_be_clickable((By.ID, "nextbtn"))
                )
                sign_in_button.click()
                print("[OK] Sign in button clicked")
                time.sleep(5)  # Wait for login to process
            except TimeoutException:
                print("[FAIL] Could not find sign in button")
                return False
            
            # Switch back to main content
            print("[STEP 6] Switching back to main content...")
            self.driver.switch_to.default_content()
            
            # Wait for page to load after login
            time.sleep(3)
            
            # Check if login was successful
            print("[STEP 7] Verifying login...")
            try:
                # Look for elements that appear after successful login
                # This might be a logout button, user menu, or dashboard elements
                page_source = self.driver.page_source
                
                if 'logout' in page_source.lower() or 'sign out' in page_source.lower():
                    print("[OK] LOGIN SUCCESSFUL - Found logout link")
                    return True
                elif 'signinFrame' not in page_source:
                    # If the signin iframe is gone, we might be logged in
                    print("[OK] LOGIN SUCCESSFUL - Signin frame removed")
                    return True
                else:
                    print("[WARN] Login status unclear - checking current URL...")
                    current_url = self.driver.current_url
                    print(f"   Current URL: {current_url}")
                    
                    if 'signin' not in current_url.lower():
                        print("[OK] LOGIN SUCCESSFUL - Not on signin page")
                        return True
                    else:
                        print("[FAIL] Still on login page")
                        # Save screenshot for debugging
                        self.driver.save_screenshot("login_failed.png")
                        print("[INFO] Screenshot saved to login_failed.png")
                        return False
                        
            except Exception as e:
                print(f"[FAIL] Error verifying login: {e}")
                return False
                
        except Exception as e:
            print(f"[FAIL] Login error: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def get_attendance_data(self):
        """Scrape attendance data from the attendance page"""
        try:
            print("\n=== FETCHING ATTENDANCE DATA ===")
            
            # Try multiple methods to access attendance page
            attendance_urls = [
                "https://academia.srmist.edu.in/#Page:My_Attendance",
                "https://academia.srmist.edu.in/Page:My_Attendance",
                "https://academia.srmist.edu.in/#My_Attendance",
                "https://academia.srmist.edu.in/#Page:Attendance",
                "https://academia.srmist.edu.in/",
            ]
            
            for attempt, url in enumerate(attendance_urls, 1):
                print(f"\n[ATTEMPT {attempt}] Navigating to: {url}")
                self.driver.get(url)
                
                # Wait for page to load and JavaScript to execute
                print("   Waiting for page to load...")
                time.sleep(8)  # Increased wait time for dynamic content
                
                print(f"   Page title: {self.driver.title}")
                print(f"   Current URL: {self.driver.current_url}")
                
                # Save page source for debugging
                filename = f'attendance_page_attempt_{attempt}.html'
                with open(filename, 'w', encoding='utf-8') as f:
                    f.write(self.driver.page_source)
                print(f"   Page source saved to {filename}")
                
                # Take screenshot
                screenshot_file = f'attendance_screenshot_{attempt}.png'
                self.driver.save_screenshot(screenshot_file)
                print(f"   Screenshot saved to {screenshot_file}")
                
                # Check if we're still on login page
                if 'signinFrame' in self.driver.page_source:
                    print("   [WARN] Still on login page, trying next URL...")
                    continue
                
                # Look for attendance-related content
                print("   Searching for attendance content...")
                
                # Check page content for attendance keywords
                page_text = self.driver.find_element(By.TAG_NAME, "body").text.lower()
                attendance_keywords = ['attendance', 'present', 'absent', 'percentage', 'conducted']
                found_keywords = [kw for kw in attendance_keywords if kw in page_text]
                
                if found_keywords:
                    print(f"   [INFO] Found attendance keywords: {found_keywords}")
                else:
                    print("   [WARN] No attendance keywords found in page text")
                
                # Try to find iframes that might contain the attendance data
                iframes = self.driver.find_elements(By.TAG_NAME, "iframe")
                print(f"   Found {len(iframes)} iframe(s)")
                
                for iframe_idx, iframe in enumerate(iframes):
                    print(f"\n   Checking iframe {iframe_idx + 1}...")
                    try:
                        # Get iframe info
                        iframe_id = iframe.get_attribute('id')
                        iframe_src = iframe.get_attribute('src')
                        print(f"      ID: {iframe_id}, Src: {iframe_src}")
                        
                        # Switch to iframe
                        self.driver.switch_to.frame(iframe)
                        
                        # Wait a bit for iframe content to load
                        time.sleep(2)
                        
                        # Look for tables in iframe
                        iframe_tables = self.driver.find_elements(By.TAG_NAME, "table")
                        print(f"      Found {len(iframe_tables)} table(s) in iframe")
                        
                        if iframe_tables:
                            # Try to extract data from first table
                            attendance_data = self._extract_table_data(iframe_tables[0], f"iframe_{iframe_idx + 1}")
                            
                            if attendance_data:
                                self.driver.switch_to.default_content()
                                return attendance_data
                        
                        # Switch back to main content
                        self.driver.switch_to.default_content()
                        
                    except Exception as e:
                        print(f"      Error checking iframe: {e}")
                        self.driver.switch_to.default_content()
                        continue
                
                # Look for tables in main content
                print("\n   Searching for tables in main content...")
                table_selectors = [
                    (By.TAG_NAME, "table"),
                    (By.XPATH, "//table[contains(@class, 'report')]"),
                    (By.XPATH, "//table[contains(@class, 'data')]"),
                    (By.XPATH, "//table[contains(@class, 'zc')]"),
                    (By.XPATH, "//div[contains(@id, 'attendance')]//table"),
                    (By.XPATH, "//div[contains(@class, 'attendance')]//table"),
                ]
                
                for by, selector in table_selectors:
                    try:
                        tables = self.driver.find_elements(by, selector)
                        if tables:
                            print(f"   [OK] Found {len(tables)} table(s) using {selector}")
                            
                            for table_idx, table in enumerate(tables):
                                attendance_data = self._extract_table_data(table, f"main_table_{table_idx + 1}")
                                if attendance_data:
                                    return attendance_data
                    except NoSuchElementException:
                        continue
                
                # If we found content (not login page), break the loop
                if 'signinFrame' not in self.driver.page_source:
                    print("\n   [INFO] Not on login page, but couldn't find attendance table")
                    print("   [INFO] Check saved HTML and screenshots for page structure")
                    break
            
            # Final check - print all text on page for debugging
            print("\n[STEP 4] Analyzing page content...")
            try:
                page_text = self.driver.find_element(By.TAG_NAME, "body").text
                print(f"   Page text length: {len(page_text)} characters")
                
                if 'attendance' in page_text.lower():
                    print("   [INFO] Found 'attendance' keyword in page")
                    # Print lines containing 'attendance'
                    for line in page_text.split('\n'):
                        if 'attendance' in line.lower():
                            print(f"      {line.strip()}")
                
                # Save page text for analysis
                with open('attendance_page_text.txt', 'w', encoding='utf-8') as f:
                    f.write(page_text)
                print("   [OK] Page text saved to attendance_page_text.txt")
                
            except Exception as e:
                print(f"   [WARN] Could not analyze page text: {e}")
            
            print("\n[FAIL] Could not find attendance data")
            print("[INFO] Check the saved files:")
            print("   - attendance_page_attempt_*.html (page source)")
            print("   - attendance_screenshot_*.png (screenshots)")
            print("   - attendance_page_text.txt (page text)")
            
            return None
                
        except Exception as e:
            print(f"[FAIL] Error fetching attendance data: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _extract_table_data(self, table, table_name="table"):
        """Helper method to extract data from a table element"""
        try:
            rows = table.find_elements(By.TAG_NAME, "tr")
            print(f"      {table_name} has {len(rows)} rows")
            
            if len(rows) == 0:
                return None
            
            attendance_data = []
            headers = []
            
            for i, row in enumerate(rows):
                # Try to get cells (td or th)
                cols = row.find_elements(By.TAG_NAME, "td")
                if not cols:
                    cols = row.find_elements(By.TAG_NAME, "th")
                
                if cols:
                    row_data = [col.text.strip() for col in cols]
                    
                    # Filter out empty rows
                    if not all(cell == '' for cell in row_data):
                        print(f"      Row {i+1}: {row_data}")
                        
                        if i == 0:
                            headers = row_data
                        else:
                            attendance_data.append(row_data)
            
            # Only return if we have actual data (not just headers)
            if attendance_data:
                print(f"      [OK] Extracted {len(attendance_data)} data rows from {table_name}")
                return attendance_data
            else:
                print(f"      [WARN] No data rows found in {table_name}")
                return None
                
        except Exception as e:
            print(f"      [WARN] Error extracting data from {table_name}: {e}")
            return None
    
    def get_unified_timetable_data(self, batch_number=1):
        """Scrape unified timetable data from the timetable page"""
        try:
            print(f"\n=== FETCHING UNIFIED TIMETABLE DATA (BATCH {batch_number}) ===")
            
            # Navigate to the unified timetable page
            timetable_url = f"https://academia.srmist.edu.in/#Page:Unified_Time_Table_2025_batch_{batch_number}"
            print(f"[STEP 1] Navigating to: {timetable_url}")
            self.driver.get(timetable_url)
            
            # Wait for page to load and JavaScript to execute
            print("   Waiting for page to load...")
            time.sleep(8)  # Allow time for dynamic content
            
            print(f"   Page title: {self.driver.title}")
            print(f"   Current URL: {self.driver.current_url}")
            
            # Save page source for debugging
            filename = f'unified_timetable_batch_{batch_number}_source.html'
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(self.driver.page_source)
            print(f"   Page source saved to {filename}")
            
            # Take screenshot
            screenshot_file = f'unified_timetable_batch_{batch_number}_screenshot.png'
            self.driver.save_screenshot(screenshot_file)
            print(f"   Screenshot saved to {screenshot_file}")
            
            # Check if we're still on login page
            if 'signinFrame' in self.driver.page_source:
                print("   [WARN] Still on login page, login might be required")
                return None
            
            # Look for timetable content
            print("   Searching for timetable content...")
            
            # Try to find iframes that might contain the timetable data
            iframes = self.driver.find_elements(By.TAG_NAME, "iframe")
            print(f"   Found {len(iframes)} iframe(s)")
            
            timetable_data = None
            
            for iframe_idx, iframe in enumerate(iframes):
                print(f"\n   Checking iframe {iframe_idx + 1}...")
                try:
                    # Get iframe info
                    iframe_id = iframe.get_attribute('id')
                    iframe_src = iframe.get_attribute('src')
                    print(f"      ID: {iframe_id}, Src: {iframe_src}")
                    
                    # Switch to iframe
                    self.driver.switch_to.frame(iframe)
                    
                    # Wait a bit for iframe content to load
                    time.sleep(3)
                    
                    # Look for timetable content in iframe
                    timetable_data = self._extract_timetable_content(f"iframe_{iframe_idx + 1}", batch_number)
                    
                    if timetable_data:
                        self.driver.switch_to.default_content()
                        return timetable_data
                    
                    # Switch back to main content
                    self.driver.switch_to.default_content()
                    
                except Exception as e:
                    print(f"      Error checking iframe: {e}")
                    self.driver.switch_to.default_content()
                    continue
            
            # Look for timetable content in main content
            print("\n   Searching for timetable content in main content...")
            timetable_data = self._extract_timetable_content("main_content", batch_number)
            
            if timetable_data:
                return timetable_data
            
            # If we found content (not login page), analyze what we have
            if 'signinFrame' not in self.driver.page_source:
                print("\n   [INFO] Not on login page, but couldn't find timetable table")
                print("   [INFO] Check saved HTML and screenshots for page structure")
                
                # Try to extract any text content that might be timetable-related
                try:
                    page_text = self.driver.find_element(By.TAG_NAME, "body").text
                    print(f"   Page text length: {len(page_text)} characters")
                    
                    # Save page text for analysis
                    with open(f'unified_timetable_batch_{batch_number}_text.txt', 'w', encoding='utf-8') as f:
                        f.write(page_text)
                    print(f"   [OK] Page text saved to unified_timetable_batch_{batch_number}_text.txt")
                    
                except Exception as e:
                    print(f"   [WARN] Could not analyze page text: {e}")
            
            print(f"\n[FAIL] Could not find unified timetable data for batch {batch_number}")
            print("[INFO] Check the saved files:")
            print(f"   - unified_timetable_batch_{batch_number}_source.html (page HTML source)")
            print(f"   - unified_timetable_batch_{batch_number}_screenshot.png (page screenshot)")
            print(f"   - unified_timetable_batch_{batch_number}_text.txt (page text)")
            
            return None
                
        except Exception as e:
            print(f"[FAIL] Error fetching unified timetable data: {e}")
            import traceback
            traceback.print_exc()
            return None

    def get_academic_planner_data(self):
        """Scrape academic planner data from the planner page"""
        try:
            print("\n=== FETCHING ACADEMIC PLANNER DATA ===")
            
            # Navigate to the academic planner page
            planner_url = "https://academia.srmist.edu.in/#Page:Academic_Planner_2025_26_ODD"
            print(f"[STEP 1] Navigating to: {planner_url}")
            self.driver.get(planner_url)
            
            # Wait for page to load and JavaScript to execute
            print("   Waiting for page to load...")
            time.sleep(8)  # Allow time for dynamic content
            
            print(f"   Page title: {self.driver.title}")
            print(f"   Current URL: {self.driver.current_url}")
            
            # Save page source for debugging
            filename = 'academic_planner_page_source.html'
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(self.driver.page_source)
            print(f"   Page source saved to {filename}")
            
            # Take screenshot
            screenshot_file = 'academic_planner_screenshot.png'
            self.driver.save_screenshot(screenshot_file)
            print(f"   Screenshot saved to {screenshot_file}")
            
            # Check if we're still on login page
            if 'signinFrame' in self.driver.page_source:
                print("   [WARN] Still on login page, login might be required")
                return None
            
            # Look for planner content
            print("   Searching for planner content...")
            
            # Try to find iframes that might contain the planner data
            iframes = self.driver.find_elements(By.TAG_NAME, "iframe")
            print(f"   Found {len(iframes)} iframe(s)")
            
            planner_data = None
            
            for iframe_idx, iframe in enumerate(iframes):
                print(f"\n   Checking iframe {iframe_idx + 1}...")
                try:
                    # Get iframe info
                    iframe_id = iframe.get_attribute('id')
                    iframe_src = iframe.get_attribute('src')
                    print(f"      ID: {iframe_id}, Src: {iframe_src}")
                    
                    # Switch to iframe
                    self.driver.switch_to.frame(iframe)
                    
                    # Wait a bit for iframe content to load
                    time.sleep(3)
                    
                    # Look for planner content in iframe
                    planner_data = self._extract_planner_content(f"iframe_{iframe_idx + 1}")
                    
                    if planner_data:
                        self.driver.switch_to.default_content()
                        return planner_data
                    
                    # Switch back to main content
                    self.driver.switch_to.default_content()
                    
                except Exception as e:
                    print(f"      Error checking iframe: {e}")
                    self.driver.switch_to.default_content()
                    continue
            
            # Look for planner content in main content
            print("\n   Searching for planner content in main content...")
            planner_data = self._extract_planner_content("main_content")
            
            if planner_data:
                return planner_data
            
            # If we found content (not login page), analyze what we have
            if 'signinFrame' not in self.driver.page_source:
                print("\n   [INFO] Not on login page, but couldn't find planner table")
                print("   [INFO] Check saved HTML and screenshots for page structure")
                
                # Try to extract any text content that might be planner-related
                try:
                    page_text = self.driver.find_element(By.TAG_NAME, "body").text
                    print(f"   Page text length: {len(page_text)} characters")
                    
                    # Save page text for analysis
                    with open('academic_planner_page_text.txt', 'w', encoding='utf-8') as f:
                        f.write(page_text)
                    print("   [OK] Page text saved to academic_planner_page_text.txt")
                    
                    # Look for planner-related keywords
                    planner_keywords = ['semester', 'exam', 'holiday', 'registration', 'academic', 'calendar', 'schedule']
                    found_keywords = []
                    
                    for keyword in planner_keywords:
                        if keyword in page_text.lower():
                            found_keywords.append(keyword)
                    
                    if found_keywords:
                        print(f"   [INFO] Found planner-related keywords: {found_keywords}")
                        
                        # Extract lines containing planner keywords
                        planner_lines = []
                        for line in page_text.split('\n'):
                            line_lower = line.lower()
                            if any(keyword in line_lower for keyword in planner_keywords):
                                planner_lines.append(line.strip())
                        
                        if planner_lines:
                            print("   [INFO] Found planner-related content:")
                            for line in planner_lines[:10]:  # Show first 10 lines
                                print(f"      {line}")
                            
                            # Return the planner lines as basic data
                            return {
                                'type': 'text_content',
                                'data': planner_lines,
                                'source': 'main_content'
                            }
                    
                except Exception as e:
                    print(f"   [WARN] Could not analyze page text: {e}")
            
            print("\n[FAIL] Could not find academic planner data")
            print("[INFO] Check the saved files:")
            print("   - academic_planner_page_source.html (page HTML source)")
            print("   - academic_planner_screenshot.png (page screenshot)")
            print("   - academic_planner_page_text.txt (page text)")
            
            return None
                
        except Exception as e:
            print(f"[FAIL] Error fetching academic planner data: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _extract_planner_content(self, source_name="content"):
        """Helper method to extract planner content from current page/iframe"""
        try:
            print(f"      Extracting planner content from {source_name}...")
            
            # Look for tables first
            tables = self.driver.find_elements(By.TAG_NAME, "table")
            if tables:
                print(f"      Found {len(tables)} table(s)")
                
                for table_idx, table in enumerate(tables):
                    planner_data = self._extract_table_data(table, f"{source_name}_table_{table_idx + 1}")
                    if planner_data:
                        return {
                            'type': 'table_data',
                            'data': planner_data,
                            'source': source_name
                        }
            
            # Look for divs with planner-related classes or IDs
            planner_selectors = [
                (By.XPATH, "//div[contains(@class, 'planner')]"),
                (By.XPATH, "//div[contains(@class, 'calendar')]"),
                (By.XPATH, "//div[contains(@class, 'schedule')]"),
                (By.XPATH, "//div[contains(@id, 'planner')]"),
                (By.XPATH, "//div[contains(@id, 'calendar')]"),
                (By.XPATH, "//div[contains(@id, 'schedule')]"),
                (By.XPATH, "//div[contains(@class, 'academic')]"),
                (By.XPATH, "//div[contains(@class, 'semester')]"),
            ]
            
            for by, selector in planner_selectors:
                try:
                    elements = self.driver.find_elements(by, selector)
                    if elements:
                        print(f"      Found {len(elements)} element(s) using {selector}")
                        
                        for elem_idx, element in enumerate(elements):
                            elem_text = element.text.strip()
                            if elem_text and len(elem_text) > 10:  # Only consider elements with substantial content
                                print(f"         Element {elem_idx + 1} content: {elem_text[:100]}...")
                                
                                # Check if this looks like planner data
                                planner_keywords = ['semester', 'exam', 'holiday', 'registration', 'academic', 'calendar', 'schedule', 'date']
                                if any(keyword in elem_text.lower() for keyword in planner_keywords):
                                    return {
                                        'type': 'div_content',
                                        'data': elem_text.split('\n'),
                                        'source': f"{source_name}_div_{elem_idx + 1}"
                                    }
                except:
                    continue
            
            # Look for lists (ul, ol)
            lists = self.driver.find_elements(By.XPATH, "//ul | //ol")
            if lists:
                print(f"      Found {len(lists)} list(s)")
                
                for list_idx, list_elem in enumerate(lists):
                    list_items = list_elem.find_elements(By.TAG_NAME, "li")
                    if list_items:
                        list_data = [item.text.strip() for item in list_items if item.text.strip()]
                        
                        if list_data:
                            # Check if this looks like planner data
                            list_text = ' '.join(list_data).lower()
                            planner_keywords = ['semester', 'exam', 'holiday', 'registration', 'academic', 'calendar', 'schedule', 'date']
                            
                            if any(keyword in list_text for keyword in planner_keywords):
                                print(f"         List {list_idx + 1} appears to contain planner data")
                                return {
                                    'type': 'list_data',
                                    'data': list_data,
                                    'source': f"{source_name}_list_{list_idx + 1}"
                                }
            
            # Look for any text content that might be planner-related
            try:
                body_text = self.driver.find_element(By.TAG_NAME, "body").text
                if body_text and len(body_text) > 50:
                    # Split into lines and filter for planner-related content
                    lines = [line.strip() for line in body_text.split('\n') if line.strip()]
                    
                    planner_keywords = ['semester', 'exam', 'holiday', 'registration', 'academic', 'calendar', 'schedule', 'date', '2025', '2026']
                    planner_lines = []
                    
                    for line in lines:
                        line_lower = line.lower()
                        if any(keyword in line_lower for keyword in planner_keywords):
                            planner_lines.append(line)
                    
                    if planner_lines:
                        print(f"      Found {len(planner_lines)} planner-related lines")
                        return {
                            'type': 'text_lines',
                            'data': planner_lines,
                            'source': source_name
                        }
            except:
                pass
            
            print(f"      No planner content found in {source_name}")
            return None
                
        except Exception as e:
            print(f"      [WARN] Error extracting planner content from {source_name}: {e}")
            return None
    
    def _extract_timetable_content(self, source_name="content", batch_number=1):
        """Helper method to extract timetable content from current page/iframe"""
        try:
            print(f"      Extracting timetable content from {source_name}...")
            
            # Look for tables first - timetable should be in a table format
            tables = self.driver.find_elements(By.TAG_NAME, "table")
            if tables:
                print(f"      Found {len(tables)} table(s)")
                
                for table_idx, table in enumerate(tables):
                    timetable_data = self._extract_timetable_table_data(table, f"{source_name}_table_{table_idx + 1}", batch_number)
                    if timetable_data:
                        return {
                            'type': 'timetable_table',
                            'data': timetable_data,
                            'source': source_name,
                            'batch': batch_number
                        }
            
            # Look for divs with timetable-related classes or IDs
            timetable_selectors = [
                (By.XPATH, "//div[contains(@class, 'timetable')]"),
                (By.XPATH, "//div[contains(@class, 'schedule')]"),
                (By.XPATH, "//div[contains(@id, 'timetable')]"),
                (By.XPATH, "//div[contains(@id, 'schedule')]"),
                (By.XPATH, "//div[contains(@class, 'unified')]"),
                (By.XPATH, "//div[contains(@class, 'grid')]"),
            ]
            
            for by, selector in timetable_selectors:
                try:
                    elements = self.driver.find_elements(by, selector)
                    if elements:
                        print(f"      Found {len(elements)} element(s) using {selector}")
                        
                        for elem_idx, element in enumerate(elements):
                            elem_text = element.text.strip()
                            if elem_text and len(elem_text) > 50:  # Only consider elements with substantial content
                                print(f"         Element {elem_idx + 1} content: {elem_text[:100]}...")
                                
                                # Check if this looks like timetable data
                                timetable_keywords = ['timetable', 'schedule', 'period', 'day', 'hour', 'batch']
                                if any(keyword in elem_text.lower() for keyword in timetable_keywords):
                                    return {
                                        'type': 'timetable_div',
                                        'data': elem_text.split('\n'),
                                        'source': f"{source_name}_div_{elem_idx + 1}",
                                        'batch': batch_number
                                    }
                except:
                    continue
            
            print(f"      No timetable content found in {source_name}")
            return None
                
        except Exception as e:
            print(f"      [WARN] Error extracting timetable content from {source_name}: {e}")
            return None
    
    def _extract_timetable_table_data(self, table, table_name="table", batch_number=1):
        """Helper method to extract data from a timetable table element"""
        try:
            rows = table.find_elements(By.TAG_NAME, "tr")
            print(f"      {table_name} has {len(rows)} rows")
            
            if len(rows) == 0:
                return None
            
            timetable_data = {
                'title': f"Unified Time Table for B.Tech / M.Tech - Batch {batch_number}",
                'time_slots': {
                    'from': [],
                    'to': []
                },
                'hour_order': [],
                'days': []
            }
            
            # Process rows to extract timetable structure
            for i, row in enumerate(rows):
                # Try to get cells (td or th)
                cols = row.find_elements(By.TAG_NAME, "td")
                if not cols:
                    cols = row.find_elements(By.TAG_NAME, "th")
                
                if cols:
                    row_data = [col.text.strip() for col in cols]
                    
                    # Filter out empty rows
                    if not all(cell == '' for cell in row_data):
                        print(f"      Row {i+1}: {row_data}")
                        
                        # Try to identify different types of rows
                        if i == 0 and 'FROM' in row_data[0].upper():
                            # Time slots FROM row
                            timetable_data['time_slots']['from'] = row_data[1:] if len(row_data) > 1 else []
                        elif i == 1 and 'TO' in row_data[0].upper():
                            # Time slots TO row
                            timetable_data['time_slots']['to'] = row_data[1:] if len(row_data) > 1 else []
                        elif i == 2 and 'HOUR' in row_data[0].upper():
                            # Hour order row
                            timetable_data['hour_order'] = row_data[1:] if len(row_data) > 1 else []
                        elif row_data[0].startswith('Day'):
                            # Day rows
                            day_data = {
                                'day_name': row_data[0],
                                'periods': row_data[1:] if len(row_data) > 1 else []
                            }
                            timetable_data['days'].append(day_data)
            
            # Only return if we have actual timetable data
            if timetable_data['days']:
                print(f"      [OK] Extracted timetable data from {table_name}")
                print(f"         Found {len(timetable_data['days'])} days")
                print(f"         Time slots FROM: {timetable_data['time_slots']['from']}")
                print(f"         Time slots TO: {timetable_data['time_slots']['to']}")
                print(f"         Hour order: {timetable_data['hour_order']}")
                return timetable_data
            else:
                print(f"      [WARN] No timetable data found in {table_name}")
                return None
                
        except Exception as e:
            print(f"      [WARN] Error extracting timetable data from {table_name}: {e}")
            return None

    def close(self):
        """Close the browser"""
        if self.driver:
            self.driver.quit()
            print("[OK] Browser closed")

def main():
    """Main function to test the scraper"""
    print("SRM ACADEMIA SCRAPER (SELENIUM)")
    print("=" * 50)
    print("\nThis scraper will:")
    print("  1. Open Chrome browser (you'll see it)")
    print("  2. Login to the portal")
    print("  3. Navigate to attendance page")
    print("  4. Extract and display attendance data")
    print("  5. Save page sources and screenshots for debugging")
    print("\n" + "=" * 50)
    
    # Create scraper instance
    scraper = None
    try:
        scraper = SRMAcademiaScraperSelenium(headless=False)
        
        # Login credentials
        email = "gr8790@srmist.edu.in"
        password = "h!Grizi34"
        
        # Try to login
        if scraper.login(email, password):
            print("\n[SUCCESS] Login successful!")
            print("\nNow attempting to fetch attendance data...")
            print("(This may take a while as we try different methods)")
            
            # Try to get attendance data
            attendance = scraper.get_attendance_data()
            
            if attendance:
                print("\n" + "=" * 50)
                print("[SUCCESS] ATTENDANCE DATA RETRIEVED!")
                print("=" * 50)
                print("\nAttendance Records:")
                print("-" * 50)
                for i, record in enumerate(attendance, 1):
                    print(f"{i}. {' | '.join(record)}")
                print("-" * 50)
                
                # Save to file
                with open('attendance_data.txt', 'w', encoding='utf-8') as f:
                    f.write("ATTENDANCE DATA\n")
                    f.write("=" * 50 + "\n\n")
                    for i, record in enumerate(attendance, 1):
                        f.write(f"{i}. {' | '.join(record)}\n")
                print("\n[OK] Attendance data saved to attendance_data.txt")
                
            else:
                print("\n" + "=" * 50)
                print("[WARN] Could not retrieve attendance data")
                print("=" * 50)
                print("\nDEBUGGING INFO:")
                print("The following files have been saved for analysis:")
                print("  - attendance_page_attempt_*.html (page HTML source)")
                print("  - attendance_screenshot_*.png (page screenshots)")  
                print("  - attendance_page_text.txt (visible page text)")
                print("\nPlease check these files to see what the page actually contains.")
                print("You can then update the selectors in the code based on the actual structure.")
        else:
            print("\n[FAIL] Login failed")
            print("Please check your credentials and network connection")
        
        # Keep browser open for inspection
        print("\n" + "=" * 50)
        print("Browser is still open for your inspection.")
        print("Press Enter to close the browser and exit...")
        print("=" * 50)
        input()
        
    except Exception as e:
        print(f"\n[FAIL] Error: {e}")
        import traceback
        traceback.print_exc()
        print("\nPress Enter to close...")
        input()
    
    finally:
        if scraper:
            scraper.close()
            print("[OK] Browser closed. Goodbye!")

if __name__ == "__main__":
    main()

