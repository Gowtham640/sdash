#!/usr/bin/env python3
"""
Fixed Calendar Data Scraper
Based on actual HTML structure analysis
"""

import re
import time
import sys
import json
from datetime import datetime
from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By
from scraper_selenium_session import SRMAcademiaScraperSelenium

def extract_calendar_data_from_html(html_content):
    """
    Extract calendar data from HTML content using BeautifulSoup.
    Based on the actual HTML structure: 6 months, each with 5 columns (Dt, Day, Event, DO, separator).
    """
    calendar_data = []
    
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Find the main calendar table
        tables = soup.find_all('table')
        
        if not tables:
            print("No tables found in HTML content")
            return calendar_data
        
        # Find the table with calendar data (should contain month headers)
        calendar_table = None
        for table in tables:
            table_text = table.get_text()
            if "Jul '25" in table_text and "Aug '25" in table_text:
                calendar_table = table
                break
        
        if not calendar_table:
            print("Calendar table not found")
            return calendar_data
        
        rows = calendar_table.find_all('tr')
        
        if not rows:
            print("No rows found in calendar table")
            return calendar_data
        
        # Find the header row to identify month positions
        header_row = None
        month_positions = {}  # month_name -> start_column_index
        month_info = {}       # month_name -> {month_num, year}
        
        for row in rows:
            cells = row.find_all(['td', 'th'])
            row_text = [cell.get_text(strip=True) for cell in cells]
            
            # Check if this row contains month headers
            if "Jul '25" in row_text:
                header_row = row
                break
        
        if not header_row:
            print("Header row with month names not found")
            return calendar_data
        
        # Parse header row to find month positions
        header_cells = header_row.find_all(['td', 'th'])
        for col_idx, cell in enumerate(header_cells):
            cell_text = cell.get_text(strip=True)
            month_match = re.match(r'^([A-Za-z]{3})\s*\'?(\d{2})$', cell_text)
            if month_match:
                month_name = month_match.group(1)
                year = int('20' + month_match.group(2))
                
                # Convert month name to number
                month_num = {
                    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
                    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
                }.get(month_name, 0)
                
                if month_num > 0:
                    month_positions[month_name] = col_idx
                    month_info[month_name] = {
                        'month_num': month_num,
                        'year': year
                    }
        
        print(f"Found months: {list(month_positions.keys())}")
        print(f"Month positions: {month_positions}")
        
        # Process data rows (skip the header row)
        for row_idx, row in enumerate(rows[1:], 1):  # Skip header row
            cells = row.find_all(['td', 'th'])
            row_data = [cell.get_text(strip=True) for cell in cells]
            
            # Process each month's data
            # Each month has 5 columns, starting at positions 0, 5, 10, 15, 20, 25
            month_names = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
            
            for month_idx, month_name in enumerate(month_names):
                month_data = month_info[month_name]
                
                # Calculate column positions for this month
                day_col = month_idx * 5      # Day number column
                day_name_col = day_col + 1   # Day name column  
                event_col = day_col + 2      # Event column
                do_col = day_col + 3         # DO column
                
                if do_col < len(row_data):
                    dt = row_data[day_col]      # Day number
                    day = row_data[day_name_col]  # Day name (Mon, Tue, etc.)
                    event = row_data[event_col] # Event content
                    do = row_data[do_col]       # Day order
                    
                    # Validate day number - it should be a number 1-31
                    if dt.isdigit() and 1 <= int(dt) <= 31:
                        day_num = int(dt)
                        
                        # Clean up day order - should only be 1-5 or "-"
                        if do.isdigit():
                            do_num = int(do)
                            if 1 <= do_num <= 5:
                                do_formatted = f"DO {do}"
                            else:
                                do_formatted = "-"
                        elif do == "-" or do == "":
                            do_formatted = "-"
                        else:
                            do_formatted = "-"
                        
                        # Create calendar entry
                        calendar_entry = {
                            'date': f"{day_num:02d}/{month_data['month_num']:02d}/{month_data['year']}",
                            'day_number': dt,
                            'day_name': day,
                            'content': event,
                            'day_order': do_formatted,
                            'month': month_data['month_num'],
                            'month_name': month_name,
                            'year': month_data['year'],
                            'source': f"table_row_{row_idx}_month_{month_name}_day_{day_num}"
                        }
                        
                        calendar_data.append(calendar_entry)
        
        print(f"Extracted {len(calendar_data)} calendar entries")
    
    except Exception as e:
        print(f"Error extracting calendar data: {e}")
        import traceback
        traceback.print_exc()
    
    return calendar_data

def display_calendar_data(calendar_data):
    """Display calendar data in a formatted way"""
    if not calendar_data:
        print("No calendar data to display", file=sys.stderr)
        return
    
    # Group data by month
    grouped_data = {}
    for entry in calendar_data:
        try:
            date_obj = datetime.strptime(entry['date'], '%d/%m/%Y')
            month_key = f"{date_obj.strftime('%b')} {date_obj.year}"
            if month_key not in grouped_data:
                grouped_data[month_key] = []
            grouped_data[month_key].append(entry)
        except:
            # If date parsing fails, put in a general category
            if 'Unknown' not in grouped_data:
                grouped_data['Unknown'] = []
            grouped_data['Unknown'].append(entry)
    
    print("\n" + "="*100, file=sys.stderr)
    print("COMPLETE ACADEMIC CALENDAR", file=sys.stderr)
    print("="*100, file=sys.stderr)
    
    for month_name, month_data in grouped_data.items():
        if month_data:
            year = month_data[0]['date'].split('/')[-1] if month_data else "2025"
            print(f"\n{'='*100}", file=sys.stderr)
            print(f"                                   {month_name.upper()} {year}", file=sys.stderr)
            print(f"{'='*100}", file=sys.stderr)
            print(f"{'Dt':<8} {'Day':<6} {'Event':<70} {'DO':<6}", file=sys.stderr)
            print("-" * 100, file=sys.stderr)
            
            for entry in month_data:
                print(f"{entry['date']:<8} {entry['day_name']:<6} {entry['content']:<70} {entry['day_order']:<6}", file=sys.stderr)
            
            print("-" * 100, file=sys.stderr)
            print(f"Total events in {month_name.upper()}: {len(month_data)}", file=sys.stderr)
    
    print(f"\n{'='*100}", file=sys.stderr)
    print(f"TOTAL CALENDAR EVENTS: {len(calendar_data)}", file=sys.stderr)
    print(f"MONTHS COVERED: {len(grouped_data)}", file=sys.stderr)
    print(f"{'='*100}", file=sys.stderr)

def save_calendar_data(calendar_data, filename="calendar_data.json"):
    """Save calendar data to a JSON file"""
    if not calendar_data:
        print("No calendar data to save", file=sys.stderr)
        return
    
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(calendar_data, f, indent=2, ensure_ascii=False)
        print(f"Calendar data saved to: {filename}", file=sys.stderr)
    except Exception as e:
        print(f"Error saving calendar data: {e}", file=sys.stderr)

if __name__ == "__main__":
    # Test the calendar extraction
    print("Testing Calendar Data Extraction...")
    
    # This would normally be called with real HTML content
    # For testing, we'll just show the function structure
    print("Calendar extraction functions ready!")
