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

This extension uses **Chrome Sync Storage** for data persistence, which means:
- ✅ Your data syncs across all your Chrome devices
- ✅ Data survives browser cache clearing
- ✅ Automatic monthly backups to local files
- ✅ Manual backup/restore functionality

### Storage Capacity
- **Sync Storage**: ~2,000 articles (512KB limit)
- **Local Backups**: Unlimited (stored as JSON files)

### Backup Features
- **Automatic**: Monthly backups created at 2am on the first day of the month
- **Manual**: Create backups anytime from the Stats page
- **Restore**: Import previous backups if needed
- **Migration**: Automatic migration from old local storage

### Backup File Format
Backup files are JSON with the following structure:
```json
{
  "version": "1.0",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "blogEntries": [...],
  "toReadEntries": [...]
}
```

