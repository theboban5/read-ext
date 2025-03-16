// Initialize storage with empty array if it doesn't exist
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get('blogEntries', function(data) {
      if (!data.blogEntries) {
        chrome.storage.local.set({blogEntries: []});
      }
    });
  });
  
  // Listen for messages from popup or stats page
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getBlogEntries') {
      chrome.storage.local.get('blogEntries', function(data) {
        sendResponse({blogEntries: data.blogEntries || []});
      });
      return true; // Required for async response
    }
  });