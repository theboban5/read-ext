// Recovery script for large datasets
// Run this in the browser console on the stats page

console.log('🔍 Checking for large dataset recovery...');

// Check both storage types
Promise.all([
  new Promise(resolve => chrome.storage.local.get(['blogEntries', 'toReadEntries'], resolve)),
  new Promise(resolve => chrome.storage.sync.get(['blogEntries', 'toReadEntries', 'chunked_metadata'], resolve))
]).then(([localData, syncData]) => {
  console.log('📊 Storage Analysis:');
  console.log('Local Storage:', localData);
  console.log('Sync Storage:', syncData);
  
  const localBlogs = localData.blogEntries || [];
  const localToRead = localData.toReadEntries || [];
  const syncBlogs = syncData.blogEntries || [];
  const syncToRead = syncData.toReadEntries || [];
  const chunkedMetadata = syncData.chunked_metadata;
  
  console.log(`📈 Data Counts:`);
  console.log(`Local - Blogs: ${localBlogs.length}, To-Read: ${localToRead.length}`);
  console.log(`Sync - Blogs: ${syncBlogs.length}, To-Read: ${syncToRead.length}`);
  console.log(`Chunked Storage: ${chunkedMetadata ? 'Yes' : 'No'}`);
  
  // Check if we have data in local but not in sync (and no chunked storage)
  if (localBlogs.length > 0 && syncBlogs.length === 0 && !chunkedMetadata) {
    console.log('🚨 Found large dataset in local storage!');
    console.log('🔄 Attempting to migrate to chunked storage...');
    
    migrateToChunkedStorage(localBlogs, localToRead);
  } else if (chunkedMetadata) {
    console.log('✅ Data found in chunked storage - everything looks good!');
    console.log('🔄 Please refresh the page to see your data.');
  } else if (localBlogs.length === 0 && syncBlogs.length === 0) {
    console.log('❌ No data found in either storage location.');
  }
});

// Function to migrate data to chunked storage
async function migrateToChunkedStorage(blogEntries, toReadEntries) {
  const CHUNK_SIZE = 50; // Number of entries per chunk
  
  try {
    console.log('📦 Splitting data into chunks...');
    
    // Split blog entries into chunks
    const blogChunks = [];
    for (let i = 0; i < blogEntries.length; i += CHUNK_SIZE) {
      blogChunks.push(blogEntries.slice(i, i + CHUNK_SIZE));
    }
    
    // Split to-read entries into chunks
    const toReadChunks = [];
    for (let i = 0; i < toReadEntries.length; i += CHUNK_SIZE) {
      toReadChunks.push(toReadEntries.slice(i, i + CHUNK_SIZE));
    }
    
    console.log(`📊 Created ${blogChunks.length} blog chunks and ${toReadChunks.length} to-read chunks`);
    
    // Store chunk metadata
    const metadata = {
      blogChunks: blogChunks.length,
      toReadChunks: toReadChunks.length,
      totalBlogs: blogEntries.length,
      totalToRead: toReadEntries.length,
      migratedAt: new Date().toISOString()
    };
    
    // Store metadata and chunks
    const storageData = {
      'chunked_metadata': metadata
    };
    
    // Add blog chunks
    blogChunks.forEach((chunk, index) => {
      storageData[`blog_chunk_${index}`] = chunk;
    });
    
    // Add to-read chunks
    toReadChunks.forEach((chunk, index) => {
      storageData[`toread_chunk_${index}`] = chunk;
    });
    
    console.log('💾 Storing data in chunked format...');
    
    // Store in sync storage
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set(storageData, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
    
    console.log('✅ Successfully migrated to chunked storage!');
    console.log('🔄 Please refresh the page to see your data.');
    
  } catch (error) {
    console.error('❌ Chunked storage migration failed:', error);
    console.log('💡 Falling back to local storage only...');
  }
}

// Function to manually trigger chunked migration
window.migrateToChunked = function() {
  console.log('🔄 Manually triggering chunked migration...');
  
  chrome.storage.local.get(['blogEntries', 'toReadEntries'], function(localData) {
    const localBlogs = localData.blogEntries || [];
    const localToRead = localData.toReadEntries || [];
    
    if (localBlogs.length > 0 || localToRead.length > 0) {
      migrateToChunkedStorage(localBlogs, localToRead);
    } else {
      console.log('❌ No data found in local storage to migrate.');
    }
  });
};

console.log('💡 If you need to manually trigger migration, run: window.migrateToChunked()'); 