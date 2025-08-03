// Verification Script - Check if the fix worked
// Run this in the browser console on the stats page

console.log('✅ Verifying the fix...');

// Check all storage types
Promise.all([
  new Promise(resolve => chrome.storage.local.get(null, resolve)),
  new Promise(resolve => chrome.storage.sync.get(null, resolve))
]).then(([localData, syncData]) => {
  console.log('📊 Storage Analysis:');
  
  const localBlogs = localData.blogEntries || [];
  const localToRead = localData.toReadEntries || [];
  const syncBlogs = syncData.blogEntries || [];
  const syncToRead = syncData.toReadEntries || [];
  
  console.log(`📈 Data Counts:`);
  console.log(`Local Storage - Blogs: ${localBlogs.length}, To-Read: ${localToRead.length}`);
  console.log(`Sync Storage - Blogs: ${syncBlogs.length}, To-Read: ${syncToRead.length}`);
  
  // Check which storage is being used
  if (localBlogs.length > 0 && syncBlogs.length === 0) {
    console.log('✅ SUCCESS: Using local storage (no more chunking!)');
  } else if (syncBlogs.length > 0) {
    console.log('⚠️ Still using sync storage');
  } else {
    console.log('❌ No data found');
  }
  
  // Check for backup
  if (localData.backup) {
    console.log('✅ Backup available:', localData.backup.timestamp);
  }
  
  // Check storage type
  if (localData.storageType === 'local') {
    console.log('✅ Storage type: Local (optimized)');
  }
  
  // Analyze dates
  console.log('\n📅 Date Analysis:');
  
  if (localBlogs.length > 0) {
    // Sort by date
    const sortedBlogs = localBlogs.sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateA - dateB;
    });
    
    const firstDate = new Date(sortedBlogs[0].date);
    const lastDate = new Date(sortedBlogs[sortedBlogs.length - 1].date);
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    
    console.log(`First article: ${firstDate.toDateString()}`);
    console.log(`Last article: ${lastDate.toDateString()}`);
    
    // Count articles in the last year
    const readsLastYear = localBlogs.filter(entry => {
      if (!entry.date) return false;
      const entryDate = new Date(entry.date);
      return entryDate >= oneYearAgo && entryDate <= today;
    }).length;
    
    console.log(`Articles in last year: ${readsLastYear}`);
    console.log(`Total articles: ${localBlogs.length}`);
    
    if (readsLastYear === localBlogs.length) {
      console.log('✅ SUCCESS: Date mismatch fixed! Numbers should match now');
    } else {
      console.log(`⚠️ Still have mismatch: ${readsLastYear} vs ${localBlogs.length}`);
    }
    
    // Check for invalid dates
    const invalidDates = localBlogs.filter(entry => {
      return !entry.date || entry.date === '' || isNaN(new Date(entry.date).getTime());
    });
    
    if (invalidDates.length === 0) {
      console.log('✅ SUCCESS: No invalid dates found');
    } else {
      console.log(`⚠️ Still have ${invalidDates.length} articles with invalid dates`);
    }
  }
  
  // Check storage size
  const localSize = JSON.stringify(localData).length;
  console.log(`\n📏 Storage Size: ${Math.round(localSize / 1024)}KB`);
  
  if (localSize < 5000000) { // 5MB
    console.log('✅ Storage size is manageable');
  } else {
    console.log('⚠️ Storage size is getting large');
  }
});

console.log('💡 Check your stats page - the numbers should now match!'); 