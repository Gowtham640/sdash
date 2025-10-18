#!/usr/bin/env python3
"""
Persistent Session Manager for SRM Academia Portal
Handles session persistence across server restarts and API calls
"""

import time
import json
import os
import sys
from datetime import datetime, timedelta
from scraper_selenium import SRMAcademiaScraperSelenium

class PersistentSessionManager:
    def __init__(self):
        self.scraper = None
        self.session_file = "session_data.json"
        self.session_timeout = 24 * 60 * 60  # 24 hours in seconds
        self.logged_in = False
        self.last_login = None
        self.email = None
        self.password = None
        
        # Load existing session if available
        self.load_session()
    
    def load_session(self):
        """Load session data from file if it exists"""
        try:
            if os.path.exists(self.session_file):
                with open(self.session_file, 'r') as f:
                    session_data = json.load(f)
                
                self.last_login = session_data.get('last_login')
                self.email = session_data.get('email')
                self.password = session_data.get('password')
                
                # Check if session is still valid
                if self.last_login and self.email and self.password:
                    time_diff = time.time() - self.last_login
                    if time_diff < self.session_timeout:
                        print(f"[SESSION] Found valid session from {time_diff/3600:.1f} hours ago", file=sys.stderr)
                        return True
                    else:
                        print(f"[SESSION] Session expired ({time_diff/3600:.1f} hours old)", file=sys.stderr)
                        self.clear_session()
                else:
                    print("[SESSION] Invalid session data found", file=sys.stderr)
                    self.clear_session()
            else:
                print("[SESSION] No existing session found", file=sys.stderr)
        except Exception as e:
            print(f"[SESSION] Error loading session: {e}", file=sys.stderr)
            self.clear_session()
        
        return False
    
    def save_session(self):
        """Save current session data to file"""
        try:
            session_data = {
                'last_login': self.last_login,
                'email': self.email,
                'password': self.password,
                'timestamp': datetime.now().isoformat()
            }
            
            with open(self.session_file, 'w') as f:
                json.dump(session_data, f, indent=2)
            
            print(f"[SESSION] Session saved to {self.session_file}", file=sys.stderr)
        except Exception as e:
            print(f"[SESSION] Error saving session: {e}", file=sys.stderr)
    
    def clear_session(self):
        """Clear session data and remove session file"""
        try:
            if os.path.exists(self.session_file):
                os.remove(self.session_file)
            
            self.last_login = None
            self.email = None
            self.password = None
            self.logged_in = False
            
            if self.scraper:
                try:
                    self.scraper.close()
                except:
                    pass
                self.scraper = None
            
            print("[SESSION] Session cleared", file=sys.stderr)
        except Exception as e:
            print(f"[SESSION] Error clearing session: {e}", file=sys.stderr)
    
    def get_scraper(self, email, password):
        """Get scraper instance, creating new one if needed"""
        now = time.time()
        
        # Check if we need to create a new scraper
        if (self.scraper is None or 
            self.last_login is None or 
            now - self.last_login > self.session_timeout or
            not self.logged_in or
            self.email != email or
            self.password != password):
            
            print("[SESSION] Creating new scraper session", file=sys.stderr)
            
            # Close existing scraper if any
            if self.scraper:
                try:
                    self.scraper.close()
                except:
                    pass
            
            # Create new scraper
            self.scraper = SRMAcademiaScraperSelenium(headless=True)
            self.email = email
            self.password = password
            self.last_login = now
            self.logged_in = False
            
            # Attempt login
            if self.scraper.login(email, password):
                self.logged_in = True
                self.save_session()
                print(f"[SESSION] Login successful for: {email}", file=sys.stderr)
            else:
                self.logged_in = False
                print(f"[SESSION] Login failed for: {email}", file=sys.stderr)
                return None
        else:
            print("[SESSION] Reusing existing session", file=sys.stderr)
        
        return self.scraper
    
    def get_calendar_data(self, email, password):
        """Get calendar data using persistent session"""
        try:
            scraper = self.get_scraper(email, password)
            if not scraper or not self.logged_in:
                print("[SESSION] No valid scraper available", file=sys.stderr)
                return []
            
            # Navigate to calendar page
            planner_url = "https://academia.srmist.edu.in/#Page:Academic_Planner_2025_26_ODD"
            print(f"[SESSION] Navigating to: {planner_url}", file=sys.stderr)
            scraper.driver.get(planner_url)
            
            # Wait for page to load
            print("[SESSION] Waiting for page to load...", file=sys.stderr)
            time.sleep(10)
            
            # Extract calendar data
            print("[SESSION] Extracting calendar data...", file=sys.stderr)
            html_content = scraper.driver.page_source
            
            # Import the calendar extraction function
            from calendar_scraper_fixed import extract_calendar_data_from_html
            calendar_data = extract_calendar_data_from_html(html_content)
            
            print(f"[SESSION] Extracted {len(calendar_data)} calendar entries", file=sys.stderr)
            return calendar_data
            
        except Exception as e:
            print(f"[SESSION] Error getting calendar data: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            return []
    
    def close(self):
        """Close the session manager"""
        if self.scraper:
            try:
                self.scraper.close()
            except:
                pass
            self.scraper = None
        print("[SESSION] Session manager closed", file=sys.stderr)

# Global session manager instance
_session_manager = None

def get_session_manager():
    """Get the global session manager instance"""
    global _session_manager
    if _session_manager is None:
        _session_manager = PersistentSessionManager()
    return _session_manager

def get_calendar_data(email, password):
    """Get calendar data using persistent session"""
    session_manager = get_session_manager()
    return session_manager.get_calendar_data(email, password)

def close_session():
    """Close the global session"""
    global _session_manager
    if _session_manager:
        _session_manager.close()
        _session_manager = None

if __name__ == "__main__":
    # Test the session manager
    print("Testing Persistent Session Manager...")
    
    email = "gr8790@srmist.edu.in"
    password = "h!Grizi34"
    
    session_manager = get_session_manager()
    
    # Test first call
    print("First call...")
    data1 = session_manager.get_calendar_data(email, password)
    print(f"First call: {len(data1)} entries")
    
    # Test second call (should reuse session)
    print("Second call...")
    data2 = session_manager.get_calendar_data(email, password)
    print(f"Second call: {len(data2)} entries")
    
    # Close session
    session_manager.close()
