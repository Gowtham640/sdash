#!/usr/bin/env python3
"""
SRM Academia Scraper with Session Management
Based on the working standalone code
"""

import os
import sys
import json
import time
import hashlib
from datetime import datetime, timedelta
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException

class SRMAcademiaScraperSelenium:
    def __init__(self, headless=False, use_session=True, user_email=None):
        """
        Initialize the scraper with Selenium and per-user session management
        
        Args:
            headless: Run Chrome in headless mode
            use_session: Enable session persistence
            user_email: User email for per-user session management (required if use_session=True)
        """
        self.headless = headless
        self.use_session = use_session
        self.user_email = user_email
        self.session_timeout = 30 * 24 * 60 * 60  # 30 days in seconds
        
        # Create per-user session files if user_email is provided
        if use_session and user_email:
            # Create a safe filename from email using hash
            email_hash = hashlib.md5(user_email.encode()).hexdigest()[:16]
            self.user_session_id = f"{user_email.split('@')[0]}_{email_hash}"
            self.session_file = f"session_data_{self.user_session_id}.json"
            print(f"[SESSION] Using per-user session for: {user_email}", file=sys.stderr)
        else:
            # Fallback to global session (backward compatibility)
            self.user_session_id = "global"
            self.session_file = "session_data.json"
            if use_session:
                print("[SESSION] Warning: No user_email provided, using global session", file=sys.stderr)
        
        # Setup Chrome options
        chrome_options = Options()
        if headless:
            chrome_options.add_argument("--headless")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)
        
        # Performance optimizations
        chrome_options.add_argument("--disable-images")  # Don't load images
        chrome_options.add_argument("--disable-plugins")  # Disable plugins
        chrome_options.add_argument("--disable-extensions")  # Disable extensions
        chrome_options.add_argument("--disable-gpu")  # Disable GPU
        chrome_options.add_argument("--disable-web-security")  # Disable web security checks
        chrome_options.add_argument("--disable-features=VizDisplayCompositor")  # Disable compositor
        chrome_options.add_argument("--disable-background-timer-throttling")  # Disable timer throttling
        chrome_options.add_argument("--disable-backgrounding-occluded-windows")  # Disable backgrounding
        chrome_options.add_argument("--disable-renderer-backgrounding")  # Disable renderer backgrounding
        
        # Additional safe performance optimizations
        chrome_options.add_argument("--disable-default-apps")  # Disable default apps
        chrome_options.add_argument("--disable-sync")  # Disable sync
        chrome_options.add_argument("--disable-translate")  # Disable translate
        chrome_options.add_argument("--disable-logging")  # Disable logging
        chrome_options.add_argument("--disable-notifications")  # Disable notifications
        chrome_options.add_argument("--disable-popup-blocking")  # Disable popup blocking
        chrome_options.add_argument("--disable-prompt-on-repost")  # Disable repost prompts
        chrome_options.add_argument("--disable-hang-monitor")  # Disable hang monitor
        chrome_options.add_argument("--disable-client-side-phishing-detection")  # Disable phishing detection
        chrome_options.add_argument("--disable-component-update")  # Disable component updates
        chrome_options.add_argument("--disable-domain-reliability")  # Disable domain reliability
        chrome_options.add_argument("--disable-features=TranslateUI")  # Disable translate UI
        chrome_options.add_argument("--disable-ipc-flooding-protection")  # Disable IPC flooding protection
        chrome_options.add_argument("--aggressive-cache-discard")  # Aggressive cache discard
        chrome_options.add_argument("--memory-pressure-off")  # Turn off memory pressure
        
        # Add session persistence if enabled (per-user profiles)
        if use_session:
            # Create a per-user persistent Chrome profile directory
            if user_email:
                profile_dir = os.path.join(os.getcwd(), "chrome_sessions", self.user_session_id)
            else:
                # Fallback to global profile
                profile_dir = os.path.join(os.getcwd(), "chrome_session_profile")
            
            if not os.path.exists(profile_dir):
                os.makedirs(profile_dir, exist_ok=True)
                print(f"[SESSION] Created profile directory: {profile_dir}", file=sys.stderr)
            
            chrome_options.add_argument(f"--user-data-dir={profile_dir}")
            print(f"[SESSION] Using Chrome profile: {profile_dir}", file=sys.stderr)
        
        try:
            self.driver = webdriver.Chrome(options=chrome_options)
            self.wait = WebDriverWait(self.driver, 20)
            print("[OK] Selenium WebDriver initialized with session management", file=sys.stderr)
        except Exception as e:
            print(f"[FAIL] Could not initialize WebDriver: {e}", file=sys.stderr)
            print("[INFO] Make sure you have Chrome and chromedriver installed", file=sys.stderr)
            raise
    
    def is_session_valid(self):
        """Check if the current session is still valid by actually testing it"""
        if not self.use_session:
            return False
        
        if not os.path.exists(self.session_file):
            print("[SESSION] No session file found", file=sys.stderr)
            return False
        
        try:
            with open(self.session_file, 'r') as f:
                session_data = json.load(f)
            
            # Check if session has expired (use timestamp field)
            if 'timestamp' in session_data:
                session_time = datetime.fromisoformat(session_data['timestamp'])
                if datetime.now() - session_time > timedelta(seconds=self.session_timeout):
                    print("[SESSION] Session expired (30 days)", file=sys.stderr)
                    return False
            
            # Actually test the session by trying to access a protected page
            try:
                print("[SESSION] Testing session validity...", file=sys.stderr)
                self.driver.get("https://academia.srmist.edu.in/#Page:Dashboard")
                time.sleep(3)
                
                # Check if we're redirected to login page
                if "Login" in self.driver.title or "signinFrame" in self.driver.page_source:
                    print("[SESSION] Session invalid - redirected to login page", file=sys.stderr)
                    return False
                else:
                    print("[SESSION] Session valid - can access protected pages", file=sys.stderr)
                    return True
                    
            except Exception as e:
                print(f"[SESSION] Error testing session: {e}", file=sys.stderr)
                return False
                
        except Exception as e:
            print(f"[SESSION] Error reading session file: {e}", file=sys.stderr)
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
            
            print(f"[SESSION] Session saved for {email}", file=sys.stderr)
        except Exception as e:
            print(f"[SESSION] Error saving session: {e}", file=sys.stderr)
    
    def login(self, email, password):
        """Login to the academia portal using Selenium with session management"""
        try:
            print(f"\n=== LOGIN WITH SELENIUM (Session: {self.use_session}) ===", file=sys.stderr)
            
            # Don't skip login - always attempt it when this method is called
            # The session validation should be done before calling this method
            
            print(f"[STEP 1] Loading portal page...", file=sys.stderr)
            self.driver.get("https://academia.srmist.edu.in/")
            time.sleep(1)  # Reduced from 3s to 1s
            
            print(f"[OK] Page loaded: {self.driver.title}", file=sys.stderr)
            
            # Switch to the iframe
            print("[STEP 2] Switching to login iframe...", file=sys.stderr)
            try:
                iframe = self.wait.until(
                    EC.presence_of_element_located((By.ID, "signinFrame"))
                )
                self.driver.switch_to.frame(iframe)
                print("[OK] Switched to iframe", file=sys.stderr)
            except TimeoutException:
                print("[ERROR] Could not find login iframe", file=sys.stderr)
                return False
            
            # Find and fill email field
            print("[STEP 3] Entering email...", file=sys.stderr)
            try:
                email_field = self.wait.until(
                    EC.presence_of_element_located((By.ID, "login_id"))
                )
                email_field.clear()
                email_field.send_keys(email)
                print(f"[OK] Email entered: {email}", file=sys.stderr)
            except TimeoutException:
                print("[ERROR] Could not find email field", file=sys.stderr)
                self.driver.switch_to.default_content()
                return False
            
            # Click Next button to reveal password field
            print("[STEP 4] Clicking Next button...", file=sys.stderr)
            try:
                next_button = self.driver.find_element(By.ID, "nextbtn")
                next_button.click()
                print("[OK] Next button clicked", file=sys.stderr)
                time.sleep(2)  # Wait for password field to appear
            except NoSuchElementException:
                print("[ERROR] Could not find Next button", file=sys.stderr)
                self.driver.switch_to.default_content()
                return False
            
            # Find and fill password field
            print("[STEP 5] Entering password...", file=sys.stderr)
            try:
                password_field = self.wait.until(
                    EC.presence_of_element_located((By.ID, "password"))
                )
                password_field.clear()
                password_field.send_keys(password)
                print("[OK] Password entered", file=sys.stderr)
            except TimeoutException:
                print("[ERROR] Could not find password field", file=sys.stderr)
                self.driver.switch_to.default_content()
                return False
            
            # Click login button (same as next button)
            print("[STEP 6] Clicking login button...", file=sys.stderr)
            try:
                login_button = self.wait.until(
                    EC.element_to_be_clickable((By.ID, "nextbtn"))
                )
                login_button.click()
                print("[OK] Login button clicked", file=sys.stderr)
            except TimeoutException:
                print("[ERROR] Could not find login button", file=sys.stderr)
                self.driver.switch_to.default_content()
                return False
            
            # Wait for login to complete
            print("[STEP 7] Waiting for login to complete...", file=sys.stderr)
            time.sleep(2)  # Reduced from 5s to 2s
            
            # Switch back to default content
            self.driver.switch_to.default_content()
            
            # Check if login was successful
            try:
                # Wait for dashboard or any protected page to load (with shorter timeout)
                WebDriverWait(self.driver, 5).until(
                    lambda driver: "Dashboard" in driver.title or "academia" in driver.current_url
                )
                
                print("[OK] Login successful!", file=sys.stderr)
                
                # Save session if enabled
                if self.use_session:
                    self.save_session(email)
                
                return True
                
            except TimeoutException:
                print("[ERROR] Login failed - timeout waiting for dashboard", file=sys.stderr)
                return False
                
        except Exception as e:
            print(f"[ERROR] Login failed: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
            return False
    
    def get_calendar_data(self):
        """Get calendar data from the academic planner page"""
        try:
            print("\n=== GETTING CALENDAR DATA ===", file=sys.stderr)
            
            # Navigate to academic planner
            planner_url = "https://academia.srmist.edu.in/#Page:Academic_Planner_2025_26_ODD"
            print(f"[STEP 1] Navigating to: {planner_url}", file=sys.stderr)
            
            self.driver.get(planner_url)
            time.sleep(10)  # Wait for page to load completely
            
            print(f"[OK] Calendar page loaded: {self.driver.title}", file=sys.stderr)
            
            # Check if we got redirected to login page
            if "Login" in self.driver.title or "signinFrame" in self.driver.page_source:
                print("[WARNING] Redirected to login page - session may have expired", file=sys.stderr)
                print("[INFO] This is normal if session was created a while ago", file=sys.stderr)
                return None
            
            # Get page source
            page_source = self.driver.page_source
            
            if not page_source:
                print("[ERROR] No page source received", file=sys.stderr)
                return None
            
            print(f"[OK] Page source received ({len(page_source)} characters)", file=sys.stderr)
            
            # Check if we got the right content
            if "Jul '25" in page_source and "Aug '25" in page_source:
                print("[OK] Calendar content detected in page source", file=sys.stderr)
                return page_source
            else:
                print("[WARNING] Calendar content not detected in page source", file=sys.stderr)
                print(f"[DEBUG] Page source contains 'Jul': {'Jul' in page_source}", file=sys.stderr)
                print(f"[DEBUG] Page source contains 'table': {'table' in page_source.lower()}", file=sys.stderr)
                return page_source  # Return anyway, let the parser handle it
            
        except Exception as e:
            print(f"[ERROR] Failed to get calendar data: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
            return None
    
    def close(self):
        """Close the browser"""
        try:
            if hasattr(self, 'driver'):
                self.driver.quit()
                print("[OK] Browser closed", file=sys.stderr)
        except Exception as e:
            print(f"[ERROR] Error closing browser: {e}", file=sys.stderr)

def main():
    """Test function"""
    scraper = SRMAcademiaScraperSelenium(headless=False, use_session=True)
    
    try:
        email = "gr8790@srmist.edu.in"
        password = "h!Grizi34"
        
        if scraper.login(email, password):
            html_content = scraper.get_calendar_data()
            if html_content:
                print(f"Got calendar HTML content: {len(html_content)} characters", file=sys.stderr)
            else:
                print("Failed to get calendar data", file=sys.stderr)
        else:
            print("Login failed", file=sys.stderr)
    
    finally:
        scraper.close()

if __name__ == "__main__":
    main()
