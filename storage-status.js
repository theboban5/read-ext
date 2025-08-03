// Storage Status Checker
// Run this in the browser console on the stats page

console.log('📊 Checking storage status...');

// Check all storage types
Promise.all([
  new Promise(resolve => chrome.storage.local.get(null, resolve)),
  new Promise(resolve => chrome.storage.sync.get(null, resolve))
]).then(([localData, syncData]) => {
  console.log('🔍 Storage Analysis:');
  
  const localBlogs = localData.blogEntries || [];
  const localToRead = localData.toReadEntries || [];
  const syncBlogs = syncData.blogEntries || [];
  const syncToRead = syncData.toReadEntries || [];
  const chunkedMetadata = syncData.chunked_metadata;
  
  console.log(`📈 Data Counts:`);
  console.log(`Local Storage - Blogs: ${localBlogs.length}, To-Read: ${localToRead.length}`);
  console.log(`Sync Storage - Blogs: ${syncBlogs.length}, To-Read: ${syncToRead.length}`);
  
  // Check storage type being used
  if (chunkedMetadata) {
    console.log(`📦 Chunked Storage: YES`);
    console.log(`   - Total Articles: ${chunkedMetadata.totalBlogs}`);
    console.log(`   - Blog Chunks: ${chunkedMetadata.blogChunks}`);
    console.log(`   - To-Read Chunks: ${chunkedMetadata.toReadChunks}`);
    console.log(`   - Migrated: ${chunkedMetadata.migratedAt}`);
    
    // Calculate storage usage
    const totalChunks = chunkedMetadata.blogChunks + chunkedMetadata.toReadChunks;
    const estimatedSize = totalChunks * 25 * 200; // Rough estimate: 25 articles per chunk, ~200 bytes per article
    console.log(`   - Estimated Size: ~${Math.round(estimatedSize / 1024)}KB`);
    
    if (estimatedSize > 400000) { // 400KB
      console.log(`⚠️ WARNING: Storage approaching 512KB limit!`);
    } else {
      console.log(`✅ Storage usage looks good`);
    }
  } else if (syncBlogs.length > 0) {
    const syncSize = JSON.stringify(syncData).length;
    console.log(`💾 Sync Storage: ${Math.round(syncSize / 1024)}KB`);
    
    if (syncSize > 60000) { // 60KB
      console.log(`⚠️ WARNING: Approaching 80KB cleanup threshold!`);
    } else {
      console.log(`✅ Sync storage usage looks good`);
    }
  } else if (localBlogs.length > 0) {
    console.log(`🏠 Local Storage: ${localBlogs.length} articles (fallback storage)`);
  } else {
    console.log(`❌ No data found in any storage`);
  }
  
  // Check for potential issues
  if (localBlogs.length > 0 && syncBlogs.length === 0 && !chunkedMetadata) {
    console.log(`⚠️ WARNING: Data only in local storage (not syncing across devices)`);
  }
  
  if (chunkedMetadata && chunkedMetadata.totalBlogs > 4000) {
    console.log(`⚠️ WARNING: Very large dataset (${chunkedMetadata.totalBlogs} articles)`);
    console.log(`💡 Consider creating a backup soon`);
  }
});

console.log('💡 Run this script anytime to check your storage status!'); 