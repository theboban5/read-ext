// Initialize storage with empty arrays if they don't exist
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['blogEntries', 'toReadEntries'], function(data) {
    if (!data.blogEntries) {
      chrome.storage.local.set({blogEntries: []});
    }
    if (!data.toReadEntries) {
      chrome.storage.local.set({toReadEntries: []});
    }
  });
});

// Function to clean up read-later list
function cleanupReadLaterList() {
  chrome.storage.local.get(['blogEntries', 'toReadEntries'], function(data) {
    const blogEntries = data.blogEntries || [];
    const toReadEntries = data.toReadEntries || [];
    
    if (blogEntries.length > 0 && toReadEntries.length > 0) {
      // Create a set of all blog URLs
      const readUrls = new Set(blogEntries.map(entry => entry.url));
      
      // Filter out already read URLs from the read-later list
      const newToReadEntries = toReadEntries.filter(entry => !readUrls.has(entry.url));
      
      // If there are entries to remove, update storage
      if (newToReadEntries.length < toReadEntries.length) {
        chrome.storage.local.set({toReadEntries: newToReadEntries});
      }
    }
  });
}

// Listen for messages from popup or stats page
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'getBlogEntries') {
    // Clean up read-later list each time blogs are requested
    cleanupReadLaterList();
    
    chrome.storage.local.get('blogEntries', function(data) {
      sendResponse({blogEntries: data.blogEntries || []});
    });
    return true; // Indicate async response
  } else if (request.action === 'getToReadEntries') {
    // Also clean up when read-later list is requested
    cleanupReadLaterList();
    
    chrome.storage.local.get('toReadEntries', function(data) {
      sendResponse({toReadEntries: data.toReadEntries || []});
    });
    return true; // Indicate async response
  }
});