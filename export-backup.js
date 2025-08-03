// Export Backup Tool
// Run this in the browser console on the stats page (then exportAll() for both CSV & JSON --- exportAsCSV() or exportAsJSON() obviously for the others)

console.log('📤 Export Backup Tool - Download your data as files');

// Function to format date for CSV
function formatDateForCSV(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toISOString().split('T')[0]; // YYYY-MM-DD format
}

// Function to create CSV content
function createCSV(articles) {
  console.log('📊 Creating CSV export...');
  
  // CSV headers
  const headers = [
    'Title',
    'URL', 
    'Author',
    'Website',
    'Rating',
    'Date',
    'Date Added'
  ];
  
  // Create CSV rows
  const rows = articles.map(article => [
    `"${(article.title || '').replace(/"/g, '""')}"`, // Escape quotes
    `"${(article.url || '').replace(/"/g, '""')}"`,
    `"${(article.author || '').replace(/"/g, '""')}"`,
    `"${(article.website || '').replace(/"/g, '""')}"`,
    article.rating || 0,
    formatDateForCSV(article.date),
    formatDateForCSV(article.dateAdded || article.date)
  ]);
  
  // Combine headers and rows
  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  
  return csvContent;
}

// Function to create JSON content
function createJSON(articles, toReadEntries) {
  console.log('📄 Creating JSON export...');
  
  const exportData = {
    version: '2.0',
    exportDate: new Date().toISOString(),
    totalArticles: articles.length,
    totalToRead: toReadEntries.length,
    blogEntries: articles,
    toReadEntries: toReadEntries
  };
  
  return JSON.stringify(exportData, null, 2); // Pretty formatted
}

// Function to download file
function downloadFile(content, filename, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  URL.revokeObjectURL(url);
  console.log(`✅ Downloaded: ${filename}`);
}

// Function to export as CSV
window.exportAsCSV = async function() {
  console.log('📤 Exporting as CSV...');
  
  try {
    // Get data from local storage
    const localData = await new Promise(resolve => {
      chrome.storage.local.get(['blogEntries', 'toReadEntries'], resolve);
    });
    
    const articles = localData.blogEntries || [];
    
    if (articles.length === 0) {
      console.log('❌ No articles found to export');
      return;
    }
    
    // Create CSV content
    const csvContent = createCSV(articles);
    
    // Create filename with date
    const date = new Date().toISOString().split('T')[0];
    const filename = `blog-tracker-export-${date}.csv`;
    
    // Download file
    downloadFile(csvContent, filename, 'text/csv');
    
    console.log(`🎉 Exported ${articles.length} articles as CSV`);
    
  } catch (error) {
    console.error('❌ Error exporting CSV:', error);
  }
};

// Function to export as JSON
window.exportAsJSON = async function() {
  console.log('📤 Exporting as JSON...');
  
  try {
    // Get data from local storage
    const localData = await new Promise(resolve => {
      chrome.storage.local.get(['blogEntries', 'toReadEntries'], resolve);
    });
    
    const articles = localData.blogEntries || [];
    const toReadEntries = localData.toReadEntries || [];
    
    if (articles.length === 0) {
      console.log('❌ No articles found to export');
      return;
    }
    
    // Create JSON content
    const jsonContent = createJSON(articles, toReadEntries);
    
    // Create filename with date
    const date = new Date().toISOString().split('T')[0];
    const filename = `blog-tracker-export-${date}.json`;
    
    // Download file
    downloadFile(jsonContent, filename, 'application/json');
    
    console.log(`🎉 Exported ${articles.length} articles and ${toReadEntries.length} to-read items as JSON`);
    
  } catch (error) {
    console.error('❌ Error exporting JSON:', error);
  }
};

// Function to export both formats
window.exportAll = async function() {
  console.log('📤 Exporting all formats...');
  
  await exportAsCSV();
  await exportAsJSON();
  
  console.log('🎉 All exports completed!');
};

// Function to show export info
window.showExportInfo = function() {
  console.log(`
📤 EXPORT OPTIONS:
1. Export as CSV (spreadsheet): exportAsCSV()
2. Export as JSON (full data): exportAsJSON()
3. Export both formats: exportAll()

💡 RECOMMENDATIONS:
- CSV: Good for viewing in Excel/Google Sheets
- JSON: Good for full backup and data portability
- Both: Best for complete backup

📁 FILES WILL BE DOWNLOADED TO:
- Mac: ~/Downloads/
- Windows: Downloads folder
- Linux: Downloads folder

🔄 BACKUP SCHEDULE SUGGESTION:
- Weekly: exportAsCSV() for quick review
- Monthly: exportAll() for full backup
- Before major changes: exportAsJSON()
`);
};

// Auto-show export info
showExportInfo(); 