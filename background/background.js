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
  const CHUNK_SIZE = 25; // Reduced chunk size to avoid quota issues
  
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
    
    // Store in sync storage with retry mechanism
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        await new Promise((resolve, reject) => {
          chrome.storage.sync.set(storageData, () => {
            if (chrome.runtime.lastError) {
              console.error('Chunked storage error (attempt ' + (retryCount + 1) + '):', chrome.runtime.lastError);
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });
        
        console.log(`Successfully migrated to chunked storage: ${blogChunks.length} blog chunks, ${toReadChunks.length} to-read chunks`);
        return; // Success, exit retry loop
        
      } catch (error) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error('Max retries reached for chunked storage, falling back to local storage');
          // Fallback to local storage
          await new Promise((resolve, reject) => {
            chrome.storage.local.set({
              blogEntries: blogEntries,
              toReadEntries: toReadEntries
            }, () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                console.log('Successfully saved to local storage as fallback');
                resolve();
              }
            });
          });
          return;
        } else {
          console.log('Retrying chunked storage migration...');
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }
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

// Function to clean up old entries to reduce storage size
function cleanupOldEntries(blogEntries) {
  // Increase limit to 2000 articles (as mentioned in README)
  const MAX_ENTRIES = 2000;
  
  if (blogEntries.length <= MAX_ENTRIES) {
    return blogEntries; // Keep all entries if under limit
  }
  
  console.log('Cleaning up old entries to reduce storage size...');
  
  // Sort by date (oldest first)
  const sortedEntries = blogEntries.sort((a, b) => {
    const dateA = new Date(a.date || 0);
    const dateB = new Date(b.date || 0);
    return dateA - dateB;
  });
  
  // Keep the most recent entries (less aggressive cleanup)
  const cleanedEntries = sortedEntries.slice(-MAX_ENTRIES);
  
  console.log(`Removed ${blogEntries.length - cleanedEntries.length} old entries`);
  return cleanedEntries;
}

// Function to check storage quota and clear if necessary
async function checkAndClearStorage() {
  try {
    // Try to get current storage usage
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get(null, resolve);
    });
    
    const totalSize = JSON.stringify(data).length;
    console.log('Current storage usage:', totalSize, 'bytes');
    
    // If storage is nearly full (>95% of 100KB), clear old data
    if (totalSize > 95000) {
      console.log('Storage nearly full, clearing old data...');
      
      // Keep only the most recent 100 entries
      const blogEntries = data.blogEntries || [];
      const toReadEntries = data.toReadEntries || [];
      
      const recentBlogs = blogEntries.slice(-100);
      const recentToRead = toReadEntries.slice(-50);
      
      await new Promise((resolve, reject) => {
        chrome.storage.sync.set({
          blogEntries: recentBlogs,
          toReadEntries: recentToRead
        }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log('Storage cleared successfully');
            resolve('Storage cleared to make room for new entries');
          }
        });
      });
    }
  } catch (error) {
    console.error('Error checking storage quota:', error);
  }
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
    console.log('Saving to-read entries to storage:', newToReadEntries.length, 'entries');
    
    // Check if we're using local storage (which we are now)
    const localData = await new Promise((resolve) => {
      chrome.storage.local.get(['blogEntries'], resolve);
    });
    
    if (localData.blogEntries && localData.blogEntries.length > 0) {
      // We're using local storage, so save to-read entries there too
      console.log('Using local storage for to-read entries');
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({toReadEntries: newToReadEntries}, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log('Successfully saved to-read entries to local storage');
            resolve();
          }
        });
      });
    } else {
      // Fallback to sync storage if no local data
      console.log('Using sync storage for to-read entries (fallback)');
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
    throw error;
  }
}

// Function to save blog entries to storage (handles both normal and chunked)
async function saveBlogEntriesToStorage(newBlogEntries) {
  try {
    console.log('Saving blog entries to storage:', newBlogEntries.length, 'entries');
    
    // Check storage quota first
    const clearMessage = await checkAndClearStorage();
    
    // Check data size
    let dataSize = JSON.stringify(newBlogEntries).length;
    console.log('Data size:', dataSize, 'bytes');
    
    // If data is too large, try to clean up old entries
    if (dataSize > 80000) { // Less aggressive cleanup threshold
      console.log('Data size approaching limit, cleaning up old entries...');
      newBlogEntries = cleanupOldEntries(newBlogEntries);
      dataSize = JSON.stringify(newBlogEntries).length;
      console.log('After cleanup - Data size:', dataSize, 'bytes, entries:', newBlogEntries.length);
    }
    
    // Check if we're using chunked storage
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get(['chunked_metadata'], resolve);
    });
    
    // Check if data is too large for sync storage (100KB limit)
    if (dataSize > 80000) { // Reduced threshold for safety
      console.log('Data too large for sync storage, migrating to chunked storage...');
      // Get current to-read entries to preserve them
      const toReadEntries = await getToReadEntriesFromStorage();
      await migrateToChunkedStorage(newBlogEntries, toReadEntries);
      return;
    }
    
    if (data.chunked_metadata) {
      console.log('Using chunked storage');
      // Update chunked storage
      await updateChunkedBlogEntries(newBlogEntries);
    } else if (dataSize > 80000) {
      // Data is too large, migrate to chunked storage
      console.log('Data too large, migrating to chunked storage...');
      const toReadEntries = await getToReadEntriesFromStorage();
      await migrateToChunkedStorage(newBlogEntries, toReadEntries);
    } else {
      console.log('Using normal sync storage');
      // Update normal sync storage with retry mechanism
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          await new Promise((resolve, reject) => {
            chrome.storage.sync.set({blogEntries: newBlogEntries}, () => {
                          if (chrome.runtime.lastError) {
              console.error('Storage error (attempt ' + (retryCount + 1) + '):', chrome.runtime.lastError);
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              console.log('Successfully saved to sync storage');
              resolve(clearMessage || 'Blog saved successfully');
            }
            });
          });
          break; // Success, exit retry loop
        } catch (error) {
          retryCount++;
          if (retryCount >= maxRetries) {
            console.error('Max retries reached, falling back to local storage');
            // Fallback to local storage
            await new Promise((resolve, reject) => {
              chrome.storage.local.set({blogEntries: newBlogEntries}, () => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  console.log('Successfully saved to local storage as fallback');
                  resolve();
                }
              });
            });
          } else {
            console.log('Retrying storage operation...');
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
          }
        }
      }
    }
      } catch (error) {
      console.error('Error saving blog entries:', error);
      
      // If chunked storage fails, try local storage as fallback
      if (error.message.includes('quota') || error.message.includes('Quota')) {
        console.log('Storage quota exceeded, falling back to local storage...');
        try {
          await new Promise((resolve, reject) => {
            chrome.storage.local.set({blogEntries: newBlogEntries}, () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                console.log('Successfully saved to local storage as fallback');
                resolve();
              }
            });
          });
          return; // Successfully saved to local storage
        } catch (localError) {
          console.error('Local storage also failed:', localError);
          throw new Error('Both sync and local storage failed: ' + error.message);
        }
      }
      
      throw error;
    }
}

// Function to update blog entries in chunked storage
async function updateChunkedBlogEntries(newBlogEntries) {
  const CHUNK_SIZE = 25; // Reduced chunk size to avoid quota issues
  
  console.log('Updating chunked blog entries:', newBlogEntries.length, 'entries');
  
  // Get existing metadata
  const data = await new Promise((resolve) => {
    chrome.storage.sync.get(['chunked_metadata'], resolve);
  });
  
  const metadata = data.chunked_metadata;
  console.log('Current metadata:', metadata);
  
  // Split new blog entries into chunks
  const blogChunks = [];
  for (let i = 0; i < newBlogEntries.length; i += CHUNK_SIZE) {
    blogChunks.push(newBlogEntries.slice(i, i + CHUNK_SIZE));
  }
  
  console.log('Created', blogChunks.length, 'chunks');
  
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
  
  console.log('Storage data keys:', Object.keys(storageData));
  
  // Store updated data
  await new Promise((resolve, reject) => {
    chrome.storage.sync.set(storageData, () => {
      if (chrome.runtime.lastError) {
        console.error('Chunked storage error:', chrome.runtime.lastError);
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        console.log('Successfully saved to chunked storage');
        resolve();
      }
    });
  });
}

// Function to update to-read entries in chunked storage
async function updateChunkedToReadEntries(newToReadEntries) {
  const CHUNK_SIZE = 25; // Reduced chunk size to avoid quota issues
  
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
    (async () => {
      try {
        await cleanupReadLaterList();
        const blogEntries = await getBlogEntriesFromStorage();
        sendResponse({blogEntries: blogEntries});
      } catch (error) {
        console.error('Error getting blog entries:', error);
        sendResponse({blogEntries: []});
      }
    })();
    return true; // Indicate async response
  } else if (request.action === 'getToReadEntries') {
    // Also clean up when read-later list is requested
    (async () => {
      try {
        await cleanupReadLaterList();
        const toReadEntries = await getToReadEntriesFromStorage();
        sendResponse({toReadEntries: toReadEntries});
      } catch (error) {
        console.error('Error getting to-read entries:', error);
        sendResponse({toReadEntries: []});
      }
    })();
    return true; // Indicate async response
  } else if (request.action === 'createBackup') {
    // Manual backup request
    (async () => {
      try {
        await createBackup();
        sendResponse({success: true, message: 'Backup created successfully'});
      } catch (error) {
        console.error('Error creating backup:', error);
        sendResponse({success: false, message: 'Backup failed: ' + error.message});
      }
    })();
    return true; // Indicate async response
  } else if (request.action === 'restoreBackup') {
    // Restore from backup
    (async () => {
      try {
        await restoreBackup(request.fileContent);
        sendResponse({success: true, message: 'Backup restored successfully'});
      } catch (error) {
        console.error('Error restoring backup:', error);
        sendResponse({success: false, message: 'Restore failed: ' + error.message});
      }
    })();
    return true; // Indicate async response
  } else if (request.action === 'saveBlogEntries') {
    // Save blog entries
    (async () => {
      try {
        const message = await saveBlogEntriesToStorage(request.blogEntries);
        sendResponse({success: true, message: message});
      } catch (error) {
        console.error('Error saving blog entries:', error);
        sendResponse({success: false, message: error.message});
      }
    })();
    return true; // Indicate async response
  } else if (request.action === 'saveToReadEntries') {
    // Save to-read entries
    (async () => {
      try {
        await updateToReadEntriesInStorage(request.toReadEntries);
        sendResponse({success: true});
      } catch (error) {
        console.error('Error saving to-read entries:', error);
        sendResponse({success: false, message: error.message});
      }
    })();
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
      console.log('Found blog entries in sync storage:', data.blogEntries.length);
      return data.blogEntries;
    }
    
    // If we have chunked metadata, get from chunked storage
    if (data.chunked_metadata) {
      console.log('Found chunked metadata, getting from chunked storage');
      return await getChunkedBlogEntries(data.chunked_metadata);
    }
    
    // Fallback to local storage
    const localData = await new Promise((resolve) => {
      chrome.storage.local.get('blogEntries', resolve);
    });
    
    if (localData.blogEntries && localData.blogEntries.length > 0) {
      console.log('Found blog entries in local storage:', localData.blogEntries.length);
    }
    
    return localData.blogEntries || [];
  } catch (error) {
    console.error('Error getting blog entries:', error);
    return [];
  }
}

// Function to get to-read entries from storage (prioritizes local storage)
async function getToReadEntriesFromStorage() {
  try {
    // First try to get from local storage (our new primary storage)
    const localData = await new Promise((resolve) => {
      chrome.storage.local.get(['toReadEntries', 'blogEntries'], resolve);
    });
    
    // If we have blog entries in local storage, use local storage for to-read too
    if (localData.blogEntries && localData.blogEntries.length > 0) {
      console.log('Found to-read entries in local storage:', (localData.toReadEntries || []).length);
      return localData.toReadEntries || [];
    }
    
    // Fallback to sync storage if no local data
    const syncData = await new Promise((resolve) => {
      chrome.storage.sync.get(['toReadEntries', 'chunked_metadata'], resolve);
    });
    
    // If we have normal to-read entries in sync, return them
    if (syncData.toReadEntries && syncData.toReadEntries.length > 0) {
      console.log('Found to-read entries in sync storage:', syncData.toReadEntries.length);
      return syncData.toReadEntries;
    }
    
    // If we have chunked metadata, get from chunked storage
    if (syncData.chunked_metadata) {
      console.log('Getting to-read entries from chunked storage');
      return await getChunkedToReadEntries(syncData.chunked_metadata);
    }
    
    console.log('No to-read entries found in any storage');
    return [];
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