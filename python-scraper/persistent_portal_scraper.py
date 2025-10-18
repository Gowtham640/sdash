#!/usr/bin/env python3
"""
Persistent Selenium Scraper for College Portal
Uses Chrome user profiles to maintain session across runs
"""

import os
import time
import json
import sys
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import TimeoutException, NoSuchElementException

class PersistentPortalScraper:
    def __init__(self, profile_name="srm_portal_session", headless=True):
        """
        Initialize persistent scraper with Chrome user profile
        
        Args:
            profile_name: Name for the Chrome profile directory
            headless: Whether to run in headless mode
        """
        self.profile_name = profile_name
        self.headless = headless
        self.driver = None
        self.wait = None
        self.session_file = "session_status.json"
        self.is_logged_in = False
        
        # Cross-platform profile path setup
        if os.name == 'nt':  # Windows
            self.profile_path = Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data" / profile_name
        else:  # Linux/Mac
            self.profile_path = Path.home() / ".config" / "google-chrome" / profile_name
        
        # Create profile directory if it doesn't exist
        self.profile_path.mkdir(parents=True, exist_ok=True)
        
        # Also create a temp profile directory for better isolation
        self.temp_profile_path = Path.cwd() / "chrome_profile_temp"
        self.temp_profile_path.mkdir(parents=True, exist_ok=True)
        
        print(f"[PERSISTENT] Profile path: {self.profile_path}", file=sys.stderr)
        
    def setup_chrome_options(self):
        """Setup Chrome options with persistent profile"""
        chrome_options = Options()
        
        # Use temp profile directory for better isolation
        chrome_options.add_argument(f"--user-data-dir={self.temp_profile_path}")
        chrome_options.add_argument(f"--profile-directory={self.profile_name}")
        
        # Headless mode
        if self.headless:
            chrome_options.add_argument("--headless")
        
        # Additional options for stability
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_argument("--disable-web-security")
        chrome_options.add_argument("--disable-features=VizDisplayCompositor")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)
        
        return chrome_options
    
    def initialize_driver(self):
        """Initialize Chrome driver with persistent profile"""
        try:
            chrome_options = self.setup_chrome_options()
            self.driver = webdriver.Chrome(options=chrome_options)
            self.wait = WebDriverWait(self.driver, 10)
            
            # Hide automation indicators
            self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            
            print("[PERSISTENT] Chrome driver initialized with persistent profile", file=sys.stderr)
            return True
            
        except Exception as e:
            print(f"[PERSISTENT] Failed to initialize driver: {e}", file=sys.stderr)
            return False
    
    def check_login_status(self):
        """Check if already logged in by visiting the portal"""
        try:
            print("[PERSISTENT] Checking login status...", file=sys.stderr)
            
            # Visit the main portal page
            self.driver.get("https://academia.srmist.edu.in/")
            time.sleep(3)
            
            # Check for login indicators
            current_url = self.driver.current_url
            page_title = self.driver.title
            
            print(f"[PERSISTENT] Current URL: {current_url}", file=sys.stderr)
            print(f"[PERSISTENT] Page title: {page_title}", file=sys.stderr)
            
            # If we're redirected to login page, we're not logged in
            if "login" in current_url.lower() or "signin" in current_url.lower():
                print("[PERSISTENT] Not logged in - redirected to login page", file=sys.stderr)
                return False
            
            # Check for logout link or dashboard elements
            try:
                # Look for elements that indicate we're logged in
                logout_elements = self.driver.find_elements(By.XPATH, "//a[contains(text(), 'Logout') or contains(text(), 'Sign Out')]")
                dashboard_elements = self.driver.find_elements(By.XPATH, "//a[contains(text(), 'Dashboard') or contains(text(), 'Home')]")
                
                if logout_elements or dashboard_elements:
                    print("[PERSISTENT] Logged in - found logout/dashboard elements", file=sys.stderr)
                    return True
                    
            except Exception as e:
                print(f"[PERSISTENT] Error checking for login indicators: {e}", file=sys.stderr)
            
            # If we can access protected pages, we're logged in
            try:
                # Try to access a protected page
                self.driver.get("https://academia.srmist.edu.in/#Page:Academic_Planner_2025_26_ODD")
                time.sleep(3)
                
                if "login" not in self.driver.current_url.lower():
                    print("[PERSISTENT] Logged in - can access protected pages", file=sys.stderr)
                    return True
                    
            except Exception as e:
                print(f"[PERSISTENT] Error accessing protected page: {e}", file=sys.stderr)
            
            print("[PERSISTENT] Login status unclear", file=sys.stderr)
            return False
            
        except Exception as e:
            print(f"[PERSISTENT] Error checking login status: {e}", file=sys.stderr)
            return False
    
    def manual_login(self, email, password):
        """Perform manual login process"""
        try:
            print("[PERSISTENT] Starting manual login process...", file=sys.stderr)
            
            # Navigate to login page
            self.driver.get("https://academia.srmist.edu.in/")
            time.sleep(3)
            
            # Switch to login iframe
            try:
                iframe = self.wait.until(EC.presence_of_element_located((By.ID, "loginFrame")))
                self.driver.switch_to.frame(iframe)
                print("[PERSISTENT] Switched to login iframe", file=sys.stderr)
            except TimeoutException:
                print("[PERSISTENT] Could not find login iframe", file=sys.stderr)
                return False
            
            # Enter email
            try:
                email_field = self.wait.until(EC.presence_of_element_located((By.ID, "login_id")))
                email_field.clear()
                email_field.send_keys(email)
                print("[PERSISTENT] Email entered", file=sys.stderr)
            except TimeoutException:
                print("[PERSISTENT] Could not find email field", file=sys.stderr)
                return False
            
            # Click Next button
            try:
                next_button = self.wait.until(EC.element_to_be_clickable((By.ID, "nextbtn")))
                next_button.click()
                print("[PERSISTENT] Next button clicked", file=sys.stderr)
                time.sleep(2)
            except TimeoutException:
                print("[PERSISTENT] Could not find Next button", file=sys.stderr)
                return False
            
            # Enter password
            try:
                password_field = self.wait.until(EC.presence_of_element_located((By.ID, "password")))
                password_field.clear()
                password_field.send_keys(password)
                print("[PERSISTENT] Password entered", file=sys.stderr)
            except TimeoutException:
                print("[PERSISTENT] Could not find password field", file=sys.stderr)
                return False
            
            # Click Sign In button
            try:
                signin_button = self.wait.until(EC.element_to_be_clickable((By.ID, "login")))
                signin_button.click()
                print("[PERSISTENT] Sign in button clicked", file=sys.stderr)
                time.sleep(5)
            except TimeoutException:
                print("[PERSISTENT] Could not find Sign In button", file=sys.stderr)
                return False
            
            # Switch back to main content
            self.driver.switch_to.default_content()
            
            # Verify login
            if self.check_login_status():
                print("[PERSISTENT] Login successful!", file=sys.stderr)
                self.save_session_status(True)
                return True
            else:
                print("[PERSISTENT] Login failed", file=sys.stderr)
                return False
                
        except Exception as e:
            print(f"[PERSISTENT] Error during manual login: {e}", file=sys.stderr)
            return False
    
    def save_session_status(self, is_logged_in):
        """Save session status to file"""
        try:
            session_data = {
                "is_logged_in": is_logged_in,
                "timestamp": time.time(),
                "profile_path": str(self.profile_path)
            }
            
            with open(self.session_file, 'w') as f:
                json.dump(session_data, f, indent=2)
            
            print(f"[PERSISTENT] Session status saved: {is_logged_in}", file=sys.stderr)
            
        except Exception as e:
            print(f"[PERSISTENT] Error saving session status: {e}", file=sys.stderr)
    
    def load_session_status(self):
        """Load session status from file"""
        try:
            if os.path.exists(self.session_file):
                with open(self.session_file, 'r') as f:
                    session_data = json.load(f)
                
                # Check if session is recent (within 24 hours)
                if time.time() - session_data.get('timestamp', 0) < 24 * 60 * 60:
                    return session_data.get('is_logged_in', False)
            
            return False
            
        except Exception as e:
            print(f"[PERSISTENT] Error loading session status: {e}", file=sys.stderr)
            return False
    
    def ensure_logged_in(self, email=None, password=None):
        """Ensure we're logged in, login if necessary"""
        try:
            # Initialize driver if not already done
            if not self.driver:
                if not self.initialize_driver():
                    return False
            
            # Check if already logged in
            if self.check_login_status():
                print("[PERSISTENT] Already logged in", file=sys.stderr)
                self.is_logged_in = True
                return True
            
            # Try to login
            if email and password:
                if self.manual_login(email, password):
                    self.is_logged_in = True
                    return True
            
            print("[PERSISTENT] Not logged in and no credentials provided", file=sys.stderr)
            return False
            
        except Exception as e:
            print(f"[PERSISTENT] Error ensuring login: {e}", file=sys.stderr)
            return False
    
    def fetch_portal_data(self, url, extract_data=True):
        """
        Fetch data from any portal URL using the persistent session
        
        Args:
            url: The portal URL to fetch
            extract_data: Whether to extract structured data or return raw HTML
            
        Returns:
            Dictionary with data or HTML content
        """
        try:
            if not self.is_logged_in:
                print("[PERSISTENT] Not logged in, cannot fetch data", file=sys.stderr)
                return None
            
            print(f"[PERSISTENT] Fetching data from: {url}", file=sys.stderr)
            
            # Navigate to the URL
            self.driver.get(url)
            time.sleep(5)  # Wait for page to load
            
            # Get page source
            page_source = self.driver.page_source
            
            if not extract_data:
                return {
                    "success": True,
                    "url": url,
                    "html": page_source,
                    "timestamp": time.time()
                }
            
            # Extract structured data based on URL
            if "Academic_Planner" in url:
                return self.extract_calendar_data(page_source)
            elif "attendance" in url.lower():
                return self.extract_attendance_data(page_source)
            elif "marks" in url.lower():
                return self.extract_marks_data(page_source)
            else:
                return {
                    "success": True,
                    "url": url,
                    "html": page_source,
                    "timestamp": time.time()
                }
                
        except Exception as e:
            print(f"[PERSISTENT] Error fetching portal data: {e}", file=sys.stderr)
            return {
                "success": False,
                "error": str(e),
                "url": url
            }
    
    def extract_calendar_data(self, html_content):
        """Extract calendar data from HTML using the proven two-pass parsing strategy"""
        try:
            from bs4 import BeautifulSoup
            import re
            
            soup = BeautifulSoup(html_content, 'html.parser')
            calendar_data = []
            
            # Find the main calendar table
            tables = soup.find_all('table')
            
            if not tables:
                print("[PERSISTENT] No tables found in HTML content", file=sys.stderr)
                return {
                    "success": True,
                    "data": [],
                    "type": "calendar",
                    "count": 0
                }
            
            # Find the table with calendar data (should contain month headers)
            calendar_table = None
            for table in tables:
                table_text = table.get_text()
                if "Jul '25" in table_text and "Aug '25" in table_text:
                    calendar_table = table
                    break
            
            if not calendar_table:
                print("[PERSISTENT] Calendar table not found", file=sys.stderr)
                return {
                    "success": True,
                    "data": [],
                    "type": "calendar",
                    "count": 0
                }
            
            rows = calendar_table.find_all('tr')
            
            if not rows:
                print("[PERSISTENT] No rows found in calendar table", file=sys.stderr)
                return {
                    "success": True,
                    "data": [],
                    "type": "calendar",
                    "count": 0
                }
            
            # FIRST PASS: Month Header Detection
            month_positions = {}
            header_row = rows[0]  # First row contains month headers
            header_cells = header_row.find_all(['td', 'th'])
            
            # Regex pattern to match month headers like "Jul '25", "Aug '25"
            month_pattern = re.compile(r'^([A-Za-z]{3})\s*\'?(\d{2})$')
            
            for col_idx, cell in enumerate(header_cells):
                cell_text = cell.get_text().strip()
                match = month_pattern.match(cell_text)
                if match:
                    month_name = match.group(1)
                    year = "20" + match.group(2)  # Convert "25" to "2025"
                    
                    # Calculate data block start position
                    # Month header is at col_idx, data starts at col_idx - 2
                    data_start_col = max(0, col_idx - 2)
                    month_positions[month_name] = {
                        'start_col': data_start_col,
                        'year': year,
                        'header_col': col_idx
                    }
            
            print(f"[PERSISTENT] Found months: {list(month_positions.keys())}", file=sys.stderr)
            print(f"[PERSISTENT] Month positions: {month_positions}", file=sys.stderr)
            
            if not month_positions:
                print("[PERSISTENT] No month headers found", file=sys.stderr)
                return {
                    "success": True,
                    "data": [],
                    "type": "calendar",
                    "count": 0
                }
            
            # SECOND PASS: Data Extraction
            for row_idx, row in enumerate(rows[1:], 1):  # Skip header row
                cells = row.find_all(['td', 'th'])
                if len(cells) < max(pos['start_col'] + 4 for pos in month_positions.values()):
                    continue  # Skip rows that don't have enough columns
                
                # Extract data for each month
                for month_name, month_info in month_positions.items():
                    start_col = month_info['start_col']
                    year = month_info['year']
                    
                    # Extract data from the 5-column block
                    if start_col + 3 < len(cells):
                        dt_raw = cells[start_col].get_text().strip()
                        day_name = cells[start_col + 1].get_text().strip()
                        event_content = cells[start_col + 2].get_text().strip()
                        day_order_raw = cells[start_col + 3].get_text().strip()
                        
                        # Skip empty entries
                        if not dt_raw or dt_raw == '-' or dt_raw.startswith('---'):
                            continue
                        
                        # Validate and format day number
                        try:
                            day_num = int(dt_raw)
                            if not (1 <= day_num <= 31):
                                continue
                        except ValueError:
                            continue
                        
                        # Validate and format day order
                        day_order = "-"
                        if day_order_raw and day_order_raw != '-':
                            try:
                                do_num = int(day_order_raw)
                                if 1 <= do_num <= 5:
                                    day_order = f"DO {do_num}"
                            except ValueError:
                                pass
                        
                        # Construct full date
                        month_num = {
                            'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
                            'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
                            'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
                        }.get(month_name, '01')
                        
                        formatted_date = f"{day_num:02d}/{month_num}/{year}"
                        
                        # Create calendar entry
                        entry = {
                            'date': formatted_date,
                            'day_name': day_name,
                            'content': event_content,
                            'day_order': day_order,
                            'month': month_num,
                            'month_name': month_name,
                            'year': year
                        }
                        
                        calendar_data.append(entry)
            
            print(f"[PERSISTENT] Extracted {len(calendar_data)} calendar entries", file=sys.stderr)
            
            return {
                "success": True,
                "data": calendar_data,
                "type": "calendar",
                "count": len(calendar_data)
            }
            
        except Exception as e:
            print(f"[PERSISTENT] Error extracting calendar data: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            return {
                "success": False,
                "error": str(e),
                "type": "calendar"
            }
    
    def extract_attendance_data(self, html_content):
        """Extract attendance data from HTML"""
        # Placeholder for attendance extraction
        return {
            "success": True,
            "data": [],
            "type": "attendance",
            "message": "Attendance extraction not implemented yet"
        }
    
    def extract_marks_data(self, html_content):
        """Extract marks data from HTML"""
        # Placeholder for marks extraction
        return {
            "success": True,
            "data": [],
            "type": "marks",
            "message": "Marks extraction not implemented yet"
        }
    
    def close(self):
        """Close the driver and cleanup"""
        try:
            if self.driver:
                self.driver.quit()
                print("[PERSISTENT] Driver closed", file=sys.stderr)
        except Exception as e:
            print(f"[PERSISTENT] Error closing driver: {e}", file=sys.stderr)

# Global scraper instance
_scraper_instance = None

def get_persistent_scraper():
    """Get the global persistent scraper instance"""
    global _scraper_instance
    if _scraper_instance is None:
        _scraper_instance = PersistentPortalScraper(headless=True)
    return _scraper_instance

def fetch_portal_data(url, email=None, password=None, extract_data=True):
    """
    Utility function to fetch data from any portal URL
    
    Args:
        url: The portal URL to fetch
        email: Email for login (if not already logged in)
        password: Password for login (if not already logged in)
        extract_data: Whether to extract structured data
        
    Returns:
        Dictionary with fetched data
    """
    scraper = get_persistent_scraper()
    
    # Ensure we're logged in
    if not scraper.ensure_logged_in(email, password):
        return {
            "success": False,
            "error": "Not logged in and no credentials provided"
        }
    
    # Fetch the data
    return scraper.fetch_portal_data(url, extract_data)

def close_persistent_scraper():
    """Close the global scraper instance"""
    global _scraper_instance
    if _scraper_instance:
        _scraper_instance.close()
        _scraper_instance = None

if __name__ == "__main__":
    # Test the persistent scraper
    print("Testing Persistent Portal Scraper...")
    
    scraper = PersistentPortalScraper(headless=True)
    
    # Try to login
    email = "gr8790@srmist.edu.in"
    password = "h!Grizi34"
    
    if scraper.ensure_logged_in(email, password):
        print("Login successful!")
        
        # Fetch calendar data
        result = scraper.fetch_portal_data("https://academia.srmist.edu.in/#Page:Academic_Planner_2025_26_ODD")
        print(f"Calendar data: {len(result.get('data', []))} entries")
        
    else:
        print("Login failed!")
    
    scraper.close()
