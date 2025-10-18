#!/usr/bin/env python3
"""
SRM Academia Portal Scraper - API Wrapper for Next.js Integration
Handles API calls from Next.js and uses persistent session management
"""

from persistent_session_manager import get_calendar_data
import sys
import json

# ============================================================================
# API FUNCTIONS FOR NEXT.JS INTEGRATION
# ============================================================================

def api_get_calendar_data(email, password):
    """API function to get calendar data using persistent session"""
    try:
        print(f"[API] Getting calendar data for: {email}", file=sys.stderr)
        calendar_data = get_calendar_data(email, password)
        
        if calendar_data:
            return {
                "success": True,
                "data": calendar_data,
                "type": "calendar"
            }
        else:
            return {"success": False, "error": "No calendar data found"}
    except Exception as e:
        return {"success": False, "error": f"API Error: {str(e)}"}

if __name__ == "__main__":
    import sys
    import json
    
    # Check if we're being called from Next.js API
    if len(sys.argv) == 1:
        try:
            # Read JSON input from stdin
            input_data = json.loads(sys.stdin.read())
            
            action = input_data.get('action')
            email = input_data.get('email')
            password = input_data.get('password')
            
            if not email or not password:
                print(json.dumps({"success": False, "error": "Email and password required"}))
                sys.exit(1)
            
            if action == 'get_calendar_data':
                result = api_get_calendar_data(email, password)
            else:
                result = {"success": False, "error": "Unknown action"}
            
            # Output result as JSON
            print(json.dumps(result))
            
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
    else:
        # If called with arguments, run the main scraper
        print("API Wrapper - Use without arguments for Next.js integration")

def main():
    """Main function to scrape all data including timetables"""
    print("SRM ACADEMIA PORTAL SCRAPER - COMPLETE SOLUTION WITH TIMETABLES")
    print("=" * 70)
    print("\nThis scraper will:")
    print("  1. Login to the SRM Academia portal")
    print("  2. Extract attendance data")
    print("  3. Extract academic planner data")
    print("  4. Extract unified timetable data (Batch 1 & 2)")
    print("  5. Display all data in formatted output")
    print("  6. Save data to files")
    print("\n" + "=" * 70)
    
    # Create scraper instance
    scraper = None
    try:
        scraper = SRMAcademiaScraperSelenium(headless=False)
        
        # Login credentials
        email = "gr8790@srmist.edu.in"
        password = "h!Grizi34"
        
        print(f"\n[INFO] Attempting login with email: {email}")
        
        # Try to login
        if scraper.login(email, password):
            print("\n[SUCCESS] Login successful!")
            
            # Scrape attendance data
            print("\n" + "=" * 70)
            print("SCRAPING ATTENDANCE DATA")
            print("=" * 70)
            
            attendance_data = scraper.get_attendance_data()
            
            if attendance_data:
                print("\n[SUCCESS] Attendance data retrieved!")
                extract_and_display_all_data(attendance_data)
                
                # Save attendance data
                with open('attendance_data_complete.txt', 'w', encoding='utf-8') as f:
                    f.write("ATTENDANCE DATA\n")
                    f.write("=" * 50 + "\n\n")
                    for i, record in enumerate(attendance_data, 1):
                        f.write(f"{i}. {' | '.join(record)}\n")
                print("\n[OK] Attendance data saved to attendance_data_complete.txt")
            else:
                print("\n[WARN] Could not retrieve attendance data")
            
            # Scrape academic planner data
            print("\n" + "=" * 70)
            print("SCRAPING ACADEMIC PLANNER DATA")
            print("=" * 70)
            
            planner_data = scraper.get_academic_planner_data()
            
            if planner_data:
                print("\n[SUCCESS] Academic planner data retrieved!")
                display_academic_planner_formatted(planner_data)
                save_planner_to_file(planner_data, 'academic_planner_complete.txt')
            else:
                print("\n[WARN] Could not retrieve academic planner data")
            
            # Scrape unified timetable data for both batches
            print("\n" + "=" * 70)
            print("SCRAPING UNIFIED TIMETABLE DATA")
            print("=" * 70)
            
            timetable_results = {}
            
            for batch_num in [1, 2]:
                print(f"\n--- SCRAPING BATCH {batch_num} ---")
                timetable_data = scraper.get_unified_timetable_data(batch_num)
                
                if timetable_data:
                    print(f"\n[SUCCESS] Batch {batch_num} timetable data retrieved!")
                    display_unified_timetable_formatted(timetable_data)
                    
                    # Save timetable data
                    save_timetable_to_file(timetable_data, f'unified_timetable_batch_{batch_num}_complete.txt')
                    
                    # Also save raw data
                    with open(f'unified_timetable_batch_{batch_num}_raw.txt', 'w', encoding='utf-8') as f:
                        f.write(f"RAW UNIFIED TIMETABLE DATA - BATCH {batch_num}\n")
                        f.write("=" * 50 + "\n\n")
                        f.write(f"Data Type: {timetable_data.get('type', 'unknown')}\n")
                        f.write(f"Source: {timetable_data.get('source', 'unknown')}\n")
                        f.write(f"Batch: {timetable_data.get('batch', batch_num)}\n")
                        f.write(f"Data:\n")
                        
                        data_content = timetable_data.get('data', {})
                        if isinstance(data_content, dict):
                            for key, value in data_content.items():
                                f.write(f"{key}: {value}\n")
                        else:
                            for i, item in enumerate(data_content, 1):
                                f.write(f"{i}. {item}\n")
                    
                    print(f"[OK] Raw timetable data saved to unified_timetable_batch_{batch_num}_raw.txt")
                    timetable_results[batch_num] = True
                else:
                    print(f"\n[WARN] Could not retrieve timetable data for batch {batch_num}")
                    timetable_results[batch_num] = False
            
            # Summary
            print("\n" + "=" * 70)
            print("SCRAPING SUMMARY")
            print("=" * 70)
            
            if attendance_data:
                print("✅ Attendance data: SUCCESS")
            else:
                print("❌ Attendance data: FAILED")
            
            if planner_data:
                print("✅ Academic planner data: SUCCESS")
            else:
                print("❌ Academic planner data: FAILED")
            
            for batch_num in [1, 2]:
                if timetable_results.get(batch_num, False):
                    print(f"✅ Unified timetable batch {batch_num}: SUCCESS")
                else:
                    print(f"❌ Unified timetable batch {batch_num}: FAILED")
            
            print("\nFiles generated:")
            print("  - attendance_data_complete.txt")
            if planner_data:
                print("  - academic_planner_complete.txt")
                print("  - academic_planner_raw.txt")
            
            for batch_num in [1, 2]:
                if timetable_results.get(batch_num, False):
                    print(f"  - unified_timetable_batch_{batch_num}_complete.txt")
                    print(f"  - unified_timetable_batch_{batch_num}_raw.txt")
            
            print("  - Various debug files (HTML, screenshots, etc.)")
            
        else:
            print("\n[FAIL] Login failed")
            print("Please check your credentials and network connection")
        
        # Keep browser open for inspection
        print("\n" + "=" * 70)
        print("Browser is still open for your inspection.")
        print("Press Enter to close the browser and exit...")
        print("=" * 70)
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

def scrape_timetables_only():
    """Function to scrape only the unified timetables"""
    print("SRM ACADEMIA PORTAL SCRAPER - TIMETABLES ONLY")
    print("=" * 50)
    
    scraper = None
    try:
        scraper = SRMAcademiaScraperSelenium(headless=False)
        
        # Login credentials
        email = "gr8790@srmist.edu.in"
        password = "h!Grizi34"
        
        if scraper.login(email, password):
            print("\n[SUCCESS] Login successful!")
            
            # Scrape timetables for both batches
            for batch_num in [1, 2]:
                print(f"\n--- SCRAPING BATCH {batch_num} ---")
                timetable_data = scraper.get_unified_timetable_data(batch_num)
                
                if timetable_data:
                    print(f"\n[SUCCESS] Batch {batch_num} timetable data retrieved!")
                    display_unified_timetable_formatted(timetable_data)
                    save_timetable_to_file(timetable_data, f'unified_timetable_batch_{batch_num}.txt')
                else:
                    print(f"\n[WARN] Could not retrieve timetable data for batch {batch_num}")
        else:
            print("\n[FAIL] Login failed")
        
        print("\nPress Enter to close...")
        input()
        
    except Exception as e:
        print(f"\n[FAIL] Error: {e}")
        input()
    
    finally:
        if scraper:
            scraper.close()

def scrape_single_timetable(batch_number):
    """Function to scrape a single timetable batch"""
    print(f"SRM ACADEMIA PORTAL SCRAPER - TIMETABLE BATCH {batch_number}")
    print("=" * 50)
    
    scraper = None
    try:
        scraper = SRMAcademiaScraperSelenium(headless=False)
        
        # Login credentials
        email = "gr8790@srmist.edu.in"
        password = "h!Grizi34"
        
        if scraper.login(email, password):
            print("\n[SUCCESS] Login successful!")
            
            # Scrape specific batch
            timetable_data = scraper.get_unified_timetable_data(batch_number)
            
            if timetable_data:
                print(f"\n[SUCCESS] Batch {batch_number} timetable data retrieved!")
                display_unified_timetable_formatted(timetable_data)
                save_timetable_to_file(timetable_data, f'unified_timetable_batch_{batch_number}.txt')
            else:
                print(f"\n[WARN] Could not retrieve timetable data for batch {batch_number}")
        else:
            print("\n[FAIL] Login failed")
        
        print("\nPress Enter to close...")
        input()
        
    except Exception as e:
        print(f"\n[FAIL] Error: {e}")
        input()
    
    finally:
        if scraper:
            scraper.close()

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "--timetables-only":
            scrape_timetables_only()
        elif sys.argv[1] == "--batch1":
            scrape_single_timetable(1)
        elif sys.argv[1] == "--batch2":
            scrape_single_timetable(2)
        else:
            print("Usage:")
            print("  python run_complete_scraper.py                    # Scrape everything")
            print("  python run_complete_scraper.py --timetables-only   # Scrape timetables only")
            print("  python run_complete_scraper.py --batch1          # Scrape batch 1 only")
            print("  python run_complete_scraper.py --batch2          # Scrape batch 2 only")
    else:
        main()
