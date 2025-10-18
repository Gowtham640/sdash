#!/usr/bin/env python3
"""
SRM Academia Scraper with Session Management
Based on the working standalone code
"""

import os
import json
import time
from datetime import datetime, timedelta
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException

class SRMAcademiaScraperSelenium:
    def __init__(self, headless=False, use_session=True):
        """Initialize the scraper with Selenium and session management"""
        self.headless = headless
        self.use_session = use_session
        self.session_file = "session_data.json"  # Use same file as persistent_portal_scraper
        self.session_timeout = 30 * 24 * 60 * 60  # 30 days in seconds
        
        # Setup Chrome options
        chrome_options = Options()
        if headless:
            chrome_options.add_argument("--headless")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)
        
        # Add session persistence if enabled
        if use_session:
            # Create a persistent Chrome profile directory
            profile_dir = os.path.join(os.getcwd(), "chrome_session_profile")
            if not os.path.exists(profile_dir):
                os.makedirs(profile_dir)
            chrome_options.add_argument(f"--user-data-dir={profile_dir}")
        
        try:
            self.driver = webdriver.Chrome(options=chrome_options)
            self.wait = WebDriverWait(self.driver, 20)
            print("[OK] Selenium WebDriver initialized with session management")
        except Exception as e:
            print(f"[FAIL] Could not initialize WebDriver: {e}")
            print("[INFO] Make sure you have Chrome and chromedriver installed")
            raise
    
    def is_session_valid(self):
        """Check if the current session is still valid - conservative approach"""
        if not self.use_session:
            return False
        
        if not os.path.exists(self.session_file):
            print("[SESSION] No session file found")
            return False
        
        try:
            with open(self.session_file, 'r') as f:
                session_data = json.load(f)
            
            # Check if session has expired (use timestamp field)
            if 'timestamp' in session_data:
                session_time = datetime.fromisoformat(session_data['timestamp'])
                if datetime.now() - session_time > timedelta(seconds=self.session_timeout):
                    print("[SESSION] Session expired (30 days)")
                    return False
            
            # If session file exists and not expired, assume it's valid
            # This avoids unnecessary login attempts
            print("[SESSION] Session file exists and not expired - assuming valid")
            return True
                
        except Exception as e:
            print(f"[SESSION] Error reading session file: {e}")
            return False
    
    def save_session(self, email):
        """Save session data to file"""
        if not self.use_session:
            return
        
        try:
            session_data = {
                'email': email,
                'timestamp': datetime.now().isoformat(),
                'status': 'logged_in'
            }
            
            with open(self.session_file, 'w') as f:
                json.dump(session_data, f)
            
            print(f"[SESSION] Session saved for {email}")
        except Exception as e:
            print(f"[SESSION] Error saving session: {e}")
    
    def login(self, email, password):
        """Login to the academia portal using Selenium with session management"""
        try:
            print(f"\n=== LOGIN WITH SELENIUM (Session: {self.use_session}) ===")
            
            # Check if we already have a valid session
            if self.use_session and self.is_session_valid():
                print("[SESSION] Using existing valid session - skipping login")
                return True
            
            print(f"[STEP 1] Loading portal page...")
            self.driver.get("https://academia.srmist.edu.in/")
            time.sleep(3)
            
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
                print("[ERROR] Could not find login iframe")
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
                print("[ERROR] Could not find email field")
                self.driver.switch_to.default_content()
                return False
            
            # Click Next button to reveal password field
            print("[STEP 4] Clicking Next button...")
            try:
                next_button = self.driver.find_element(By.ID, "nextbtn")
                next_button.click()
                print("[OK] Next button clicked")
                time.sleep(2)  # Wait for password field to appear
            except NoSuchElementException:
                print("[ERROR] Could not find Next button")
                self.driver.switch_to.default_content()
                return False
            
            # Find and fill password field
            print("[STEP 5] Entering password...")
            try:
                password_field = self.wait.until(
                    EC.presence_of_element_located((By.ID, "password"))
                )
                password_field.clear()
                password_field.send_keys(password)
                print("[OK] Password entered")
            except TimeoutException:
                print("[ERROR] Could not find password field")
                self.driver.switch_to.default_content()
                return False
            
            # Click login button (same as next button)
            print("[STEP 6] Clicking login button...")
            try:
                login_button = self.wait.until(
                    EC.element_to_be_clickable((By.ID, "nextbtn"))
                )
                login_button.click()
                print("[OK] Login button clicked")
            except TimeoutException:
                print("[ERROR] Could not find login button")
                self.driver.switch_to.default_content()
                return False
            
            # Wait for login to complete
            print("[STEP 7] Waiting for login to complete...")
            time.sleep(5)
            
            # Switch back to default content
            self.driver.switch_to.default_content()
            
            # Check if login was successful
            try:
                # Wait for dashboard or any protected page to load
                self.wait.until(
                    lambda driver: "Dashboard" in driver.title or "academia" in driver.current_url
                )
                
                print("[OK] Login successful!")
                
                # Save session if enabled
                if self.use_session:
                    self.save_session(email)
                
                return True
                
            except TimeoutException:
                print("[ERROR] Login failed - timeout waiting for dashboard")
                return False
                
        except Exception as e:
            print(f"[ERROR] Login failed: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def get_calendar_data(self):
        """Get calendar data from the academic planner page"""
        try:
            print("\n=== GETTING CALENDAR DATA ===")
            
            # Navigate to academic planner
            planner_url = "https://academia.srmist.edu.in/#Page:Academic_Planner_2025_26_ODD"
            print(f"[STEP 1] Navigating to: {planner_url}")
            
            self.driver.get(planner_url)
            time.sleep(10)  # Wait for page to load completely
            
            print(f"[OK] Calendar page loaded: {self.driver.title}")
            
            # Check if we got redirected to login page
            if "Login" in self.driver.title or "signinFrame" in self.driver.page_source:
                print("[WARNING] Redirected to login page - session may have expired")
                print("[INFO] This is normal if session was created a while ago")
                return None
            
            # Get page source
            page_source = self.driver.page_source
            
            if not page_source:
                print("[ERROR] No page source received")
                return None
            
            print(f"[OK] Page source received ({len(page_source)} characters)")
            
            # Check if we got the right content
            if "Jul '25" in page_source and "Aug '25" in page_source:
                print("[OK] Calendar content detected in page source")
                return page_source
            else:
                print("[WARNING] Calendar content not detected in page source")
                print(f"[DEBUG] Page source contains 'Jul': {'Jul' in page_source}")
                print(f"[DEBUG] Page source contains 'table': {'table' in page_source.lower()}")
                return page_source  # Return anyway, let the parser handle it
            
        except Exception as e:
            print(f"[ERROR] Failed to get calendar data: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def close(self):
        """Close the browser"""
        try:
            if hasattr(self, 'driver'):
                self.driver.quit()
                print("[OK] Browser closed")
        except Exception as e:
            print(f"[ERROR] Error closing browser: {e}")

def main():
    """Test function"""
    scraper = SRMAcademiaScraperSelenium(headless=False, use_session=True)
    
    try:
        email = "gr8790@srmist.edu.in"
        password = "h!Grizi34"
        
        if scraper.login(email, password):
            html_content = scraper.get_calendar_data()
            if html_content:
                print(f"Got calendar HTML content: {len(html_content)} characters")
            else:
                print("Failed to get calendar data")
        else:
            print("Login failed")
    
    finally:
        scraper.close()

if __name__ == "__main__":
    main()
