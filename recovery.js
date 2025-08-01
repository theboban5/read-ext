// Recovery script to check and restore data
// Run this in the browser console on the stats page

console.log('🔍 Checking for lost data...');

// Check both storage types
Promise.all([
  new Promise(resolve => chrome.storage.local.get(['blogEntries', 'toReadEntries'], resolve)),
  new Promise(resolve => chrome.storage.sync.get(['blogEntries', 'toReadEntries'], resolve))
]).then(([localData, syncData]) => {
  console.log('📊 Storage Analysis:');
  console.log('Local Storage:', localData);
  console.log('Sync Storage:', syncData);
  
  const localBlogs = localData.blogEntries || [];
  const localToRead = localData.toReadEntries || [];
  const syncBlogs = syncData.blogEntries || [];
  const syncToRead = syncData.toReadEntries || [];
  
  console.log(`📈 Data Counts:`);
  console.log(`Local - Blogs: ${localBlogs.length}, To-Read: ${localToRead.length}`);
  console.log(`Sync - Blogs: ${syncBlogs.length}, To-Read: ${syncToRead.length}`);
  
  // Check if we have data in local but not sync
  if (localBlogs.length > 0 && syncBlogs.length === 0) {
    console.log('🚨 Found data in local storage but not in sync storage!');
    console.log('🔄 Attempting to restore data...');
    
    chrome.storage.sync.set({
      blogEntries: localBlogs,
      toReadEntries: localToRead
    }, () => {
      console.log('✅ Data restored to sync storage!');
      console.log('🔄 Please refresh the page to see your data.');
    });
  } else if (localBlogs.length === 0 && syncBlogs.length === 0) {
    console.log('❌ No data found in either storage location.');
    console.log('💡 If you had data before, it may have been lost during the update.');
  } else if (syncBlogs.length > 0) {
    console.log('✅ Data found in sync storage - everything looks good!');
  }
});

// Function to manually trigger migration
window.forceMigration = function() {
  console.log('🔄 Forcing migration from local to sync...');
  
  chrome.storage.local.get(['blogEntries', 'toReadEntries'], function(localData) {
    if (localData.blogEntries && localData.blogEntries.length > 0) {
      chrome.storage.sync.set({
        blogEntries: localData.blogEntries || [],
        toReadEntries: localData.toReadEntries || []
      }, function() {
        console.log('✅ Migration completed!');
        console.log('🔄 Please refresh the page.');
      });
    } else {
      console.log('❌ No data found in local storage to migrate.');
    }
  });
};

console.log('💡 If you need to force migration, run: window.forceMigration()'); 