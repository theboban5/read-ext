# read-ext

simple reading tracker chrome extension

track and rate the blogs you read 

+ view 'stats' - incl. your top rated, favorite writers/sites, etc 

no time to read an article now? add urls directly to a 'read later' list for easy access for your future self

---

## Getting Started

### Installation

1. **Download the extension**
   - Click the green "Code" button above and select "Download ZIP"
   - Or clone this repository: `git clone https://github.com/yourusername/read-ext.git`

2. **Extract the files**
   - Unzip the downloaded file (if using ZIP download)
   - You should have a folder called `read-ext` with all the extension files

3. **Open Chrome Extensions**
   - Open Chrome and go to `chrome://extensions/`

4. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

5. **Load the Extension**
   - Click "Load unpacked" button
   - Navigate to and select the `read-ext` folder you extracted
   - Click "Select Folder"

6. **Verify Installation**
   - You should see "Blog Tracker" appear in your extensions list
   - The extension icon should appear in your Chrome toolbar

### First Use

1. **Add your first article**
   - Click the extension icon in your toolbar
   - Fill in the article details (URL, title and website should be autofilled, you need to add author(s) and rating)
   - Click "Save" to add it to your reading history

2. **View your stats**
   - Click the extension icon and select "Stats" or go to the stats page
   - See your reading activity, favorite authors, and top-rated articles

3. **Use the read-later list**
   - When you find an article you want to read later, click the extension icon
   - Fill in the details and click "Add to Read Later"
   - Access your read-later list from the extension menu

### Permissions

This extension requires the following permissions:
- **Storage**: To save your reading data
- **Active Tab**: To access the current webpage
- **Tabs**: To open articles in new tabs
- **Downloads**: To create backup files
- **Alarms**: To schedule automatic monthly backups

All data is stored locally and synced across your Chrome devices.

## Storage & Backup

This extension uses **Chrome Local Storage** as its single source of truth (~10MB, ~10,000+ articles). On first run after upgrading, any data left behind in `chrome.storage.sync` (including the older chunked layout) is merged into local automatically.

### Automatic backups
- **Every 100 new entries**: a JSON snapshot is downloaded to your Downloads folder automatically (filename: `blog-tracker-auto-backup-YYYY-MM-DD-<count>.json`).
- **Monthly**: a JSON snapshot is downloaded on a 30-day cadence (`blog-tracker-monthly-backup-...json`).
- **Manual**: trigger a backup any time from the Stats page.

### Data Export & Backup
To create external backups of your data:

1. **Open the Stats page** in your extension
2. **Open the browser console** (F12 → Console tab)
3. **Copy and paste** the contents of `export-backup.js` into the console
4. **Run export commands**:
   - `exportAsCSV()` - Download as spreadsheet (Excel/Sheets)
   - `exportAsJSON()` - Download complete backup
   - `exportAll()` - Download both formats (recommended)

### Backup Schedule
- **Weekly**: `exportAsCSV()` for quick review
- **Monthly**: `exportAll()` for complete backup
- **Before major changes**: `exportAsJSON()` for safety

Files are automatically dated and downloaded to your Downloads folder.

### Troubleshooting

**Data Loss Prevention:**
- **Regular exports**: Use `exportAll()` monthly
- **Before browser updates**: Export your data
- **Before clearing cache**: Export your data
- **Multiple backups**: Keep exports in different locations

**If Data is Lost:**
- Check if you have recent export files
- Data may still be in local storage (survives most cache clearing)
- Contact support if you need help recovering data

**Storage Issues:**
- Local storage has much higher limits than sync storage
- No more chunking or quota exceeded errors
- If you reach 10,000+ articles, consider periodic cleanup of old entries

### Backup Features
- **Automatic**: Built-in backups stored in local storage
- **Manual Export**: Download CSV/JSON files anytime
- **Multiple Formats**: CSV for analysis, JSON for complete backup
- **Auto-dated**: Files include export date in filename

### Export File Formats

**CSV Format** (for Excel/Sheets):
```csv
Title,URL,Author,Website,Rating,Date,Date Added
"How to Start Google","https://example.com",Paul Graham,paulgraham.com,4,2025-03-16,2025-03-16
```

**JSON Format** (complete backup):
```json
{
  "version": "2.0",
  "exportDate": "2025-08-03T19:30:00.000Z",
  "totalArticles": 575,
  "totalToRead": 368,
  "blogEntries": [...],
  "toReadEntries": [...]
}
```

