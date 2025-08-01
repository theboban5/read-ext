// Initialize storage with empty arrays if they don't exist
chrome.runtime.onInstalled.addListener(() => {
  // Check if we need to migrate from local to sync storage
  migrateFromLocalToSync().then(() => {
    // Initialize sync storage (primary storage)
    chrome.storage.sync.get(['blogEntries', 'toReadEntries'], function(data) {
      if (!data.blogEntries) {
        chrome.storage.sync.set({blogEntries: []});
      }
      if (!data.toReadEntries) {
        chrome.storage.sync.set({toReadEntries: []});
      }
    });
    
    // Set up monthly backup schedule
    setupMonthlyBackup();
  });
});

// Migration function to move data from local to sync storage
async function migrateFromLocalToSync() {
  try {
    // Check both storages
    const [syncData, localData] = await Promise.all([
      new Promise((resolve) => {
        chrome.storage.sync.get(['blogEntries', 'toReadEntries'], resolve);
      }),
      new Promise((resolve) => {
        chrome.storage.local.get(['blogEntries', 'toReadEntries'], resolve);
      })
    ]);
    
    const syncBlogs = syncData.blogEntries || [];
    const syncToRead = syncData.toReadEntries || [];
    const localBlogs = localData.blogEntries || [];
    const localToRead = localData.toReadEntries || [];
    
    console.log('Migration check:', {
      syncBlogs: syncBlogs.length,
      syncToRead: syncToRead.length,
      localBlogs: localBlogs.length,
      localToRead: localToRead.length
    });
    
    // If sync storage is empty but local has data, migrate
    if ((syncBlogs.length === 0 && syncToRead.length === 0) && 
        (localBlogs.length > 0 || localToRead.length > 0)) {
      
      console.log('Migrating data from local to sync storage...');
      
      // Check if data is too large for sync storage
      const totalDataSize = JSON.stringify(localBlogs).length + JSON.stringify(localToRead).length;
      console.log('Total data size:', totalDataSize, 'bytes');
      
      if (totalDataSize > 90000) { // Leave some buffer for 100KB limit
        console.log('Data too large for sync storage, using chunked storage...');
        await migrateToChunkedStorage(localBlogs, localToRead);
      } else {
        // Try normal sync storage
        try {
          await new Promise((resolve, reject) => {
            chrome.storage.sync.set({
              blogEntries: localBlogs,
              toReadEntries: localToRead
            }, () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve();
              }
            });
          });
          console.log('Successfully migrated data to sync storage');
        } catch (error) {
          console.log('Sync storage failed, falling back to chunked storage:', error.message);
          await migrateToChunkedStorage(localBlogs, localToRead);
        }
      }
      
      // Keep local storage as backup for now
      // chrome.storage.local.clear();
    } else if (syncBlogs.length > 0 || syncToRead.length > 0) {
      console.log('Sync storage already has data, skipping migration');
    } else {
      console.log('No data found in either storage');
    }
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

// Function to migrate data to chunked storage
async function migrateToChunkedStorage(blogEntries, toReadEntries) {
  const CHUNK_SIZE = 50; // Number of entries per chunk
  
  try {
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
    
    console.log(`Successfully migrated to chunked storage: ${blogChunks.length} blog chunks, ${toReadChunks.length} to-read chunks`);
  } catch (error) {
    console.error('Chunked storage migration failed:', error);
    throw error;
  }
}

// Set up monthly backup schedule
function setupMonthlyBackup() {
  chrome.storage.local.get(['lastBackupDate'], function(data) {
    const now = new Date();
    const lastBackup = data.lastBackupDate ? new Date(data.lastBackupDate) : null;
    
    // If no backup has been done or it's been more than a month, schedule one
    if (!lastBackup || (now - lastBackup) > (30 * 24 * 60 * 60 * 1000)) {
      // Schedule backup for next day at 2 AM
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(2, 0, 0, 0);
      
      const delay = tomorrow.getTime() - now.getTime();
      
      chrome.alarms.create('monthlyBackup', {
        when: tomorrow.getTime()
      });
    }
  });
}

// Function to clean up read-later list
async function cleanupReadLaterList() {
  try {
    const blogEntries = await getBlogEntriesFromStorage();
    const toReadEntries = await getToReadEntriesFromStorage();
    
    if (blogEntries.length > 0 && toReadEntries.length > 0) {
      // Create a set of all blog URLs
      const readUrls = new Set(blogEntries.map(entry => entry.url));
      
      // Filter out already read URLs from the read-later list
      const newToReadEntries = toReadEntries.filter(entry => !readUrls.has(entry.url));
      
      // If there are entries to remove, update storage
      if (newToReadEntries.length < toReadEntries.length) {
        await updateToReadEntriesInStorage(newToReadEntries);
      }
    }
  } catch (error) {
    console.error('Error cleaning up read-later list:', error);
  }
}

// Function to update to-read entries in storage (handles both normal and chunked)
async function updateToReadEntriesInStorage(newToReadEntries) {
  try {
    // Check if we're using chunked storage
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get(['chunked_metadata'], resolve);
    });
    
    if (data.chunked_metadata) {
      // Update chunked storage
      await updateChunkedToReadEntries(newToReadEntries);
    } else {
      // Update normal sync storage
      await new Promise((resolve, reject) => {
        chrome.storage.sync.set({toReadEntries: newToReadEntries}, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    }
  } catch (error) {
    console.error('Error updating to-read entries:', error);
  }
}

// Function to save blog entries to storage (handles both normal and chunked)
async function saveBlogEntriesToStorage(newBlogEntries) {
  try {
    // Check if we're using chunked storage
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get(['chunked_metadata'], resolve);
    });
    
    if (data.chunked_metadata) {
      // Update chunked storage
      await updateChunkedBlogEntries(newBlogEntries);
    } else {
      // Update normal sync storage
      await new Promise((resolve, reject) => {
        chrome.storage.sync.set({blogEntries: newBlogEntries}, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    }
  } catch (error) {
    console.error('Error saving blog entries:', error);
    throw error;
  }
}

// Function to update blog entries in chunked storage
async function updateChunkedBlogEntries(newBlogEntries) {
  const CHUNK_SIZE = 50;
  
  // Get existing metadata
  const data = await new Promise((resolve) => {
    chrome.storage.sync.get(['chunked_metadata'], resolve);
  });
  
  const metadata = data.chunked_metadata;
  
  // Split new blog entries into chunks
  const blogChunks = [];
  for (let i = 0; i < newBlogEntries.length; i += CHUNK_SIZE) {
    blogChunks.push(newBlogEntries.slice(i, i + CHUNK_SIZE));
  }
  
  // Update metadata
  const updatedMetadata = {
    ...metadata,
    blogChunks: blogChunks.length,
    totalBlogs: newBlogEntries.length
  };
  
  // Prepare storage data
  const storageData = {
    'chunked_metadata': updatedMetadata
  };
  
  // Add new blog chunks
  blogChunks.forEach((chunk, index) => {
    storageData[`blog_chunk_${index}`] = chunk;
  });
  
  // Remove old blog chunks
  for (let i = blogChunks.length; i < metadata.blogChunks; i++) {
    storageData[`blog_chunk_${i}`] = null; // This will remove the key
  }
  
  // Store updated data
  await new Promise((resolve, reject) => {
    chrome.storage.sync.set(storageData, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// Function to update to-read entries in chunked storage
async function updateChunkedToReadEntries(newToReadEntries) {
  const CHUNK_SIZE = 50;
  
  // Get existing metadata
  const data = await new Promise((resolve) => {
    chrome.storage.sync.get(['chunked_metadata'], resolve);
  });
  
  const metadata = data.chunked_metadata;
  
  // Split new to-read entries into chunks
  const toReadChunks = [];
  for (let i = 0; i < newToReadEntries.length; i += CHUNK_SIZE) {
    toReadChunks.push(newToReadEntries.slice(i, i + CHUNK_SIZE));
  }
  
  // Update metadata
  const updatedMetadata = {
    ...metadata,
    toReadChunks: toReadChunks.length,
    totalToRead: newToReadEntries.length
  };
  
  // Prepare storage data
  const storageData = {
    'chunked_metadata': updatedMetadata
  };
  
  // Add new to-read chunks
  toReadChunks.forEach((chunk, index) => {
    storageData[`toread_chunk_${index}`] = chunk;
  });
  
  // Remove old to-read chunks
  for (let i = toReadChunks.length; i < metadata.toReadChunks; i++) {
    storageData[`toread_chunk_${i}`] = null; // This will remove the key
  }
  
  // Store updated data
  await new Promise((resolve, reject) => {
    chrome.storage.sync.set(storageData, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// Listen for messages from popup or stats page
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'getBlogEntries') {
    // Clean up read-later list each time blogs are requested
    cleanupReadLaterList();
    
    getBlogEntriesFromStorage().then(blogEntries => {
      sendResponse({blogEntries: blogEntries});
    });
    return true; // Indicate async response
  } else if (request.action === 'getToReadEntries') {
    // Also clean up when read-later list is requested
    cleanupReadLaterList();
    
    getToReadEntriesFromStorage().then(toReadEntries => {
      sendResponse({toReadEntries: toReadEntries});
    });
    return true; // Indicate async response
  } else if (request.action === 'createBackup') {
    // Manual backup request
    createBackup().then(() => {
      sendResponse({success: true, message: 'Backup created successfully'});
    }).catch((error) => {
      sendResponse({success: false, message: 'Backup failed: ' + error.message});
    });
    return true; // Indicate async response
  } else if (request.action === 'restoreBackup') {
    // Restore from backup
    restoreBackup(request.fileContent).then(() => {
      sendResponse({success: true, message: 'Backup restored successfully'});
    }).catch((error) => {
      sendResponse({success: false, message: 'Restore failed: ' + error.message});
    });
    return true; // Indicate async response
  } else if (request.action === 'saveBlogEntries') {
    // Save blog entries
    saveBlogEntriesToStorage(request.blogEntries).then(() => {
      sendResponse({success: true});
    }).catch((error) => {
      sendResponse({success: false, message: error.message});
    });
    return true; // Indicate async response
  } else if (request.action === 'saveToReadEntries') {
    // Save to-read entries
    updateToReadEntriesInStorage(request.toReadEntries).then(() => {
      sendResponse({success: true});
    }).catch((error) => {
      sendResponse({success: false, message: error.message});
    });
    return true; // Indicate async response
  }
});

// Function to get blog entries from storage (handles both normal and chunked)
async function getBlogEntriesFromStorage() {
  try {
    // First try to get from normal sync storage
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get(['blogEntries', 'chunked_metadata'], resolve);
    });
    
    // If we have normal blog entries, return them
    if (data.blogEntries && data.blogEntries.length > 0) {
      return data.blogEntries;
    }
    
    // If we have chunked metadata, get from chunked storage
    if (data.chunked_metadata) {
      return await getChunkedBlogEntries(data.chunked_metadata);
    }
    
    // Fallback to local storage
    const localData = await new Promise((resolve) => {
      chrome.storage.local.get('blogEntries', resolve);
    });
    
    return localData.blogEntries || [];
  } catch (error) {
    console.error('Error getting blog entries:', error);
    return [];
  }
}

// Function to get to-read entries from storage (handles both normal and chunked)
async function getToReadEntriesFromStorage() {
  try {
    // First try to get from normal sync storage
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get(['toReadEntries', 'chunked_metadata'], resolve);
    });
    
    // If we have normal to-read entries, return them
    if (data.toReadEntries && data.toReadEntries.length > 0) {
      return data.toReadEntries;
    }
    
    // If we have chunked metadata, get from chunked storage
    if (data.chunked_metadata) {
      return await getChunkedToReadEntries(data.chunked_metadata);
    }
    
    // Fallback to local storage
    const localData = await new Promise((resolve) => {
      chrome.storage.local.get('toReadEntries', resolve);
    });
    
    return localData.toReadEntries || [];
  } catch (error) {
    console.error('Error getting to-read entries:', error);
    return [];
  }
}

// Function to get blog entries from chunked storage
async function getChunkedBlogEntries(metadata) {
  const blogEntries = [];
  
  for (let i = 0; i < metadata.blogChunks; i++) {
    const chunkData = await new Promise((resolve) => {
      chrome.storage.sync.get(`blog_chunk_${i}`, resolve);
    });
    
    if (chunkData[`blog_chunk_${i}`]) {
      blogEntries.push(...chunkData[`blog_chunk_${i}`]);
    }
  }
  
  return blogEntries;
}

// Function to get to-read entries from chunked storage
async function getChunkedToReadEntries(metadata) {
  const toReadEntries = [];
  
  for (let i = 0; i < metadata.toReadChunks; i++) {
    const chunkData = await new Promise((resolve) => {
      chrome.storage.sync.get(`toread_chunk_${i}`, resolve);
    });
    
    if (chunkData[`toread_chunk_${i}`]) {
      toReadEntries.push(...chunkData[`toread_chunk_${i}`]);
    }
  }
  
  return toReadEntries;
}

// Listen for alarm events (monthly backup)
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'monthlyBackup') {
    createBackup().then(() => {
      // Schedule next monthly backup
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setHours(2, 0, 0, 0);
      
      chrome.alarms.create('monthlyBackup', {
        when: nextMonth.getTime()
      });
    });
  }
});

// Create backup function
async function createBackup() {
  try {
    const data = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(['blogEntries', 'toReadEntries'], function(result) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });

    const backupData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      blogEntries: data.blogEntries || [],
      toReadEntries: data.toReadEntries || []
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const filename = `blog-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;

    await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: false
      }, function(downloadId) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      });
    });

    // Update last backup date
    await new Promise((resolve) => {
      chrome.storage.local.set({lastBackupDate: new Date().toISOString()}, resolve);
    });

    // Clean up the URL
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Backup failed:', error);
    throw error;
  }
}

// Restore backup function
async function restoreBackup(fileContent) {
  try {
    const backupData = JSON.parse(fileContent);
    
    if (!backupData.blogEntries || !backupData.toReadEntries) {
      throw new Error('Invalid backup file format');
    }

    await new Promise((resolve, reject) => {
      chrome.storage.sync.set({
        blogEntries: backupData.blogEntries,
        toReadEntries: backupData.toReadEntries
      }, function() {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    console.error('Restore failed:', error);
    throw error;
  }
}