#!/usr/bin/env python3
"""
Test script to verify calendar_scraper_fixed.py JSON output
"""

from calendar_scraper_fixed import get_calendar_data_json

# Test with sample HTML (this won't trigger any login)
sample_html = """
<html>
<body>
<table>
<tr>
<td>Jul '25</td><td>Aug '25</td>
</tr>
<tr>
<td>01/07/2025</td><td>Tue</td><td>Muharram - Holiday</td><td>DO 1</td>
</tr>
<tr>
<td>02/07/2025</td><td>Wed</td><td>Regular Day</td><td>DO 2</td>
</tr>
</table>
</body>
</html>
"""

# Test the JSON output
json_output = get_calendar_data_json(sample_html)
print("JSON Output:")
print(json_output)
