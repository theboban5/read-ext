# read-ext

simple reading tracker chrome extension

track and rate the blogs you read 

+ view 'stats' - incl. your top rated, favorite writers/sites, etc 

no time to read an article now? add urls directly to a 'read later' list for easy access for your future self

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
- **Automatic**: Monthly backups created at 2 AM
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

