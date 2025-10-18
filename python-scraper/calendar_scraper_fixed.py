#!/usr/bin/env python3
"""
Fixed Calendar Data Scraper
Based on actual HTML structure analysis
"""

import re
import time
import sys
from datetime import datetime
from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By
from scraper_selenium import SRMAcademiaScraperSelenium

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
            print("No tables found in HTML content", file=sys.stderr)
            return calendar_data
        
        # Find the table with calendar data (should contain month headers)
        calendar_table = None
        for table in tables:
            table_text = table.get_text()
            if "Jul '25" in table_text and "Aug '25" in table_text:
                calendar_table = table
                break
        
        if not calendar_table:
            print("Calendar table not found", file=sys.stderr)
            return calendar_data
        
        rows = calendar_table.find_all('tr')
        
        if not rows:
            print("No rows found in calendar table", file=sys.stderr)
            return calendar_data
        
        # Find the header row to identify month positions
        header_row = None
        for row in rows:
            cells = row.find_all(['td', 'th'])
            if len(cells) >= 5:
                cell_texts = [cell.get_text().strip() for cell in cells]
                if "Jul '25" in cell_texts and "Aug '25" in cell_texts:
                    header_row = row
                    break
        
        if not header_row:
            print("Header row with month names not found", file=sys.stderr)
            return calendar_data
        
        # Extract month positions from header row
        month_positions = {}
        header_cells = header_row.find_all(['td', 'th'])
        for i, cell in enumerate(header_cells):
            cell_text = cell.get_text().strip()
            if "'25" in cell_text or "'26" in cell_text:
                month_positions[i] = cell_text
        
        print(f"Found months: {list(month_positions.keys())}", file=sys.stderr)
        print(f"Month positions: {month_positions}", file=sys.stderr)
        
        # Process data rows
        for row in rows[1:]:  # Skip header row
            cells = row.find_all(['td', 'th'])
            if len(cells) >= 5:
                # Extract data from each cell
                date_cell = cells[0].get_text().strip()
                day_cell = cells[1].get_text().strip()
                event_cell = cells[2].get_text().strip()
                do_cell = cells[3].get_text().strip()
                
                # Skip empty rows or separator rows
                if not date_cell or date_cell == '-' or date_cell.startswith('---'):
                    continue
                
                # Parse date
                try:
                    if '/' in date_cell:
                        date_obj = datetime.strptime(date_cell, '%d/%m/%Y')
                        formatted_date = date_obj.strftime('%d/%m/%Y')
                    else:
                        formatted_date = date_cell
                except:
                    formatted_date = date_cell
                
                # Create calendar entry
                entry = {
                    'date': formatted_date,
                    'day_name': day_cell,
                    'content': event_cell,
                    'day_order': do_cell
                }
                
                calendar_data.append(entry)
        
        print(f"Extracted {len(calendar_data)} calendar entries", file=sys.stderr)
        
    except Exception as e:
        print(f"Error extracting calendar data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
    
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
