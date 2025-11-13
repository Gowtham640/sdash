# SDash Backend - Complete Setup Guide

## 📋 PROJECT OVERVIEW

### What is SDash?

**SDash** (SRM Dashboard) is a student portal dashboard that fetches and displays academic information from the SRM Academia Portal, including:

- 📅 **Calendar Events** - University calendar with important dates
- ⏰ **Timetable** - Daily class schedule
- 📊 **Attendance** - Subject-wise attendance records
- 📝 **Marks** - Assessment marks and grades

### What This Backend Does

This backend serves as an **API layer** that:

1. Receives requests from the Next.js frontend
2. Scrapes data from the SRM Academia Portal using Selenium
3. Parses and structures the data into JSON
4. Returns it to the frontend for display

### Why Separate Backend?

- ✅ **Selenium requires a full browser** (can't run in Vercel serverless)
- ✅ **Python scraper needs persistent sessions** (to avoid repeated logins)
- ✅ **Better scalability** - backend handles heavy scraping, frontend stays fast
- ✅ **Environment isolation** - Python dependencies don't bloat frontend

---

## 🛠️ TECH STACK

### Core Technologies

| Technology         | Purpose                   | Version |
| ------------------ | ------------------------- | ------- |
| **Python**         | Main backend language     | 3.11+   |
| **Flask**          | Web framework for API     | 3.0.0   |
| **Selenium**       | Web scraping & automation | 4.15.0  |
| **BeautifulSoup4** | HTML parsing              | 4.12.2  |
| **ChromeDriver**   | Browser automation        | Latest  |

### Deployment

- **Render.com** - Hosts Python backend (free tier available)
- **Vercel** - Hosts Next.js frontend

---

## 📁 PROJECT STRUCTURE

```
backend/
├── app.py                              # Flask API server (main entry point)
├── requirements.txt                     # Python dependencies
├── .env                                # Environment variables (optional)
├── python-scraper/                     # Core scraping logic
│   ├── api_wrapper.py                  # API functions for all data types
│   ├── scraper_selenium_session.py     # Selenium browser automation
│   ├── timetable_scraper.py            # Timetable-specific scraping
│   └── calendar_scraper_fixed.py       # Calendar parsing logic
└── README.md                           # This file
```

---

## 🔧 INSTALLATION & SETUP

### Step 1: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 2: Run Locally

```bash
python app.py
```

Backend will run on `http://localhost:5000`

### Step 3: Test API

```bash
curl -X POST http://localhost:5000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"action":"validate_credentials","email":"test@srmist.edu.in","password":"test"}'
```

---

## 📝 FILES EXPLANATION

### 1. `app.py` - Flask API Server

**Purpose:** Main entry point for the backend API. Handles HTTP requests and routes them to the appropriate Python scraper functions.

**How it works:**

1. Flask receives HTTP POST request with JSON data
2. Extracts action, email, password, and other parameters
3. Routes to appropriate scraper function based on `action`
4. Returns JSON response

**Key Functions:**

- `scrape()` - Main API endpoint that processes all scraping requests
- `health()` - Health check endpoint for monitoring

**Links to rest of code:**

- Calls functions from `python-scraper/api_wrapper.py`
- Uses `flask-cors` to handle CORS from frontend
- Returns standardized JSON responses

---

### 2. `requirements.txt` - Dependencies

**Purpose:** Lists all Python packages needed for the backend.

**Dependencies Explained:**

- `Flask` - Web framework to create API endpoints
- `flask-cors` - Handles Cross-Origin Resource Sharing (needed for frontend to call backend)
- `selenium` - Web browser automation (simulates Chrome to scrape portal)
- `beautifulsoup4` - HTML parser to extract data from web pages
- `chromedriver-binary` - Chrome WebDriver binary (for Selenium)

---

### 3. `python-scraper/api_wrapper.py` - Core Scraper Logic

**Purpose:** Contains the main API functions for scraping all data types from the SRM portal.

**Key Functions:**

#### `api_get_all_data(email, password, force_refresh=False)`

- **Purpose:** Fetches all data types (calendar, attendance, marks, timetable) in a single request
- **Parameters:**
  - `email` - Student email (required)
  - `password` - Portal password (optional if session exists)
  - `force_refresh` - Force fresh scrape (ignore cache)
- **Returns:** JSON with all data types
- **How it links:** Called by Flask app.py when action is "get_all_data"

#### `api_validate_credentials(email, password)`

- **Purpose:** Validates user credentials by attempting login
- **Returns:** Success/failure status
- **How it links:** Called during authentication flow

#### `api_get_calendar_data(email, password, force_refresh=False)`

- **Purpose:** Fetches university calendar events
- **Returns:** Array of calendar events
- **How it links:** Called by api_get_all_data() or directly for calendar-only requests

#### `api_get_timetable_data(email, password)`

- **Purpose:** Fetches class timetable
- **Returns:** Timetable with slots, courses, rooms
- **How it links:** Called by api_get_all_data() or directly for timetable-only requests

#### `api_get_attendance_data(email, password)`

- **Purpose:** Fetches attendance records
- **Returns:** Subject-wise attendance percentages
- **How it links:** Called by api_get_attendance_and_marks_data() within api_get_all_data()

#### `api_get_marks_data(email, password)`

- **Purpose:** Fetches assessment marks
- **Returns:** Marks for all subjects and assessments
- **How it links:** Called by api_get_attendance_and_marks_data() within api_get_all_data()

**Main Entry Point:**

```python
if __name__ == "__main__":
    # Reads JSON from stdin (called by Flask subprocess)
    # Routes to appropriate function based on action
    # Returns JSON output
```

**How it links with other files:**

- Uses `scraper_selenium_session.py` for browser automation
- Uses `timetable_scraper.py` for timetable-specific parsing
- Uses `calendar_scraper_fixed.py` for calendar parsing
- Returns structured JSON to Flask app.py

---

### 4. `python-scraper/scraper_selenium_session.py` - Browser Automation

**Purpose:** Handles Selenium WebDriver automation to control Chrome browser for scraping.

**Key Classes:**

#### `SRMAcademiaScraperSelenium`

- **Purpose:** Main scraper class that manages browser sessions and page interactions

**Key Methods:**

##### `__init__(headless, use_session, user_email)`

- **Purpose:** Initializes Chrome WebDriver
- **Parameters:**
  - `headless` - Run Chrome in background (True) or visible (False)
  - `use_session` - Enable session persistence (save login state)
  - `user_email` - User email for per-user sessions
- **How it links:** Called by api_wrapper.py functions to create scraper instance

##### `login(email, password)`

- **Purpose:** Logs into SRM Academia Portal
- **Flow:**
  1. Navigate to portal homepage
  2. Find and switch to login iframe
  3. Enter email and password
  4. Submit form
  5. Wait for dashboard to load
  6. Save session for future use
- **Returns:** True if login successful, False otherwise
- **How it links:** Called before scraping any protected data

##### `is_session_valid()`

- **Purpose:** Checks if existing session is still valid
- **Returns:** True if session exists and hasn't expired
- **How it links:** Used to avoid unnecessary logins

##### `get_calendar_data()`

- **Purpose:** Navigates to calendar page and returns HTML
- **Returns:** Page HTML content
- **How it links:** Called by api_get_calendar_data() in api_wrapper.py

##### `close()`

- **Purpose:** Closes Chrome browser and cleans up
- **How it links:** Called after scraping is complete

**How it links with other files:**

- Imported and used by `api_wrapper.py`
- Manages browser state that other scrapers read from
- Returns raw HTML to parser functions

---

### 5. `python-scraper/timetable_scraper.py` - Timetable Parsing

**Purpose:** Contains timetable-specific scraping and parsing logic.

**Key Functions:**

#### `get_timetable_page_html(scraper)`

- **Purpose:** Navigates to timetable page and waits for dynamic content to load
- **Returns:** HTML content of timetable page
- **How it links:** Called by api_get_timetable_data() in api_wrapper.py

#### `extract_timetable_data_from_html(html_content)`

- **Purpose:** Parses HTML to extract timetable data using BeautifulSoup
- **Returns:** List of courses with slots, rooms, faculty
- **How it links:** Called by api_get_timetable_data() after getting HTML

#### `create_do_timetable_json(slot_mapping, batch_number)`

- **Purpose:** Structures timetable data into JSON format for frontend
- **Returns:** Structured JSON object
- **How it links:** Called by api_get_timetable_data() before returning result

**How it links with other files:**

- Called by `api_wrapper.py` for timetable-specific operations
- Uses `beautifulsoup4` for HTML parsing
- Returns structured data to `api_wrapper.py`

---

### 6. `python-scraper/calendar_scraper_fixed.py` - Calendar Parsing

**Purpose:** Contains calendar event parsing logic.

**Key Functions:**

#### `extract_calendar_data_from_html(html_content)`

- **Purpose:** Parses HTML to extract calendar events
- **Returns:** List of events with dates, descriptions
- **How it links:** Called by api_get_calendar_data() in api_wrapper.py

**How it links with other files:**

- Called by `api_wrapper.py` for calendar-specific parsing
- Uses `beautifulsoup4` for HTML parsing
- Returns structured data to `api_wrapper.py`

---

## 🔄 DATA FLOW

```
1. Frontend (Next.js/Vercel)
   ↓ HTTP POST request

2. Flask App (app.py)
   ↓ Routes to appropriate function

3. API Wrapper (api_wrapper.py)
   ↓ Creates scraper instance

4. Selenium Scraper (scraper_selenium_session.py)
   ↓ Navigates to portal pages

5. SRM Portal
   ↓ Returns HTML

6. BeautifulSoup Parser
   ↓ Extracts structured data

7. API Wrapper
   ↓ Formats as JSON

8. Flask App
   ↓ Returns HTTP response

9. Frontend
   ↓ Displays data in UI
```

---

## 🚀 DEPLOYMENT TO RENDER

### Step 1: Create Render Account

1. Go to [render.com](https://render.com)
2. Sign up with GitHub

### Step 2: Create New Web Service

1. Click "New" → "Web Service"
2. Connect your GitHub repository
3. Select the repository containing this backend code

### Step 3: Configure Settings

- **Name:** `sdash-backend` (or your choice)
- **Region:** Choose closest to users
- **Branch:** `main` (or your default branch)
- **Root Directory:** `backend/` (if code is in subdirectory)
- **Runtime:** `Python 3`
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `python app.py`

### Step 4: Environment Variables (Optional)

Add these if needed:

```
PYTHON_VERSION=3.11
```

### Step 5: Deploy

Click "Create Web Service" and wait for deployment.

### Step 6: Get Backend URL

After deployment, copy your backend URL:

```
https://sdash-backend.onrender.com
```

### Step 7: Update Frontend

Add to frontend `.env.local`:

```
NEXT_PUBLIC_BACKEND_URL=https://sdash-backend.onrender.com
```

---

## 🧪 TESTING

### Test Health Endpoint

```bash
curl https://your-backend.onrender.com/health
```

Expected: `{"status":"ok"}`

### Test Scraping

```bash
curl -X POST https://your-backend.onrender.com/api/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "action": "validate_credentials",
    "email": "test@srmist.edu.in",
    "password": "test123"
  }'
```

---

## 🐛 TROUBLESHOOTING

### Issue: "Module not found"

**Solution:** Run `pip install -r requirements.txt` again

### Issue: "ChromeDriver not found"

**Solution:** Make sure `chromedriver-binary` is in requirements.txt

### Issue: "Session timeout"

**Solution:** The backend automatically retries with login. Check credentials.

### Issue: "CORS error"

**Solution:** Make sure `flask-cors` is installed and CORS is enabled in app.py

### Issue: "Render deployment fails"

**Solution:** Check build logs in Render dashboard for Python errors

---

## 📊 API ENDPOINTS

### POST `/api/scrape`

Main endpoint for all scraping operations.

**Request Body:**

```json
{
  "action": "get_all_data",
  "email": "user@srmist.edu.in",
  "password": "password123",
  "force_refresh": false
}
```

**Actions Available:**

- `validate_credentials` - Check if login works
- `get_all_data` - Get all data types
- `get_calendar_data` - Get calendar only
- `get_timetable_data` - Get timetable only
- `get_attendance_data` - Get attendance only
- `get_marks_data` - Get marks only

**Response:**

```json
{
  "success": true,
  "calendar": {...},
  "timetable": {...},
  "attendance": {...},
  "marks": {...}
}
```

---

## 🔐 SECURITY NOTES

1. **Password Handling:** Never log passwords. They're only used for portal authentication.
2. **Session Management:** Sessions are stored per-user with email hash.
3. **HTTPS:** Use HTTPS in production (Render provides SSL automatically).
4. **Rate Limiting:** Consider adding rate limiting for production use.

---

## 📈 SCALING CONSIDERATIONS

- **Free Tier:** 750 hours/month (31 days) on Render
- **Paid Tier:** $7/month for always-on service
- **Caching:** Calendar data is cached for 6 hours to reduce scraping
- **Sessions:** Per-user sessions reduce login frequency

---

## 🤝 CONTRIBUTING

When adding new features:

1. Keep scraping logic in `python-scraper/` folder
2. Add new API functions in `api_wrapper.py`
3. Update `app.py` to handle new actions
4. Test locally before deploying
5. Update this documentation

---

## 📞 SUPPORT

For issues or questions:

1. Check Render deployment logs
2. Check Python logs in Render dashboard
3. Test API endpoints with curl
4. Verify dependencies in requirements.txt

---

**Last Updated:** 2024




