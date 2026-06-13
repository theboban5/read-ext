document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements
    const urlInput = document.getElementById('url');
    const titleInput = document.getElementById('title');
    const authorInput = document.getElementById('author');
    const websiteInput = document.getElementById('website');
    const ratingInput = document.getElementById('rating');
    const saveBtn = document.getElementById('save-btn');
    const readLaterBtn = document.getElementById('read-later-btn');
    const messageDiv = document.getElementById('message');
    const stars = document.querySelectorAll('.star');
    const randomizer = document.getElementById('randomizer');
  
    // Get current tab's URL
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      urlInput.value = currentTab.url;
      titleInput.value = currentTab.title || '';
      
      // Extract website domain
      try {
        const url = new URL(currentTab.url);
        websiteInput.value = url.hostname.replace('www.', '');
      } catch (e) {
        websiteInput.value = '';
      }
    });
  
    // Handle star rating
    stars.forEach(star => {
      star.addEventListener('click', function() {
        const value = parseInt(this.getAttribute('data-value'));
        ratingInput.value = value;
        
        // Update stars UI
        stars.forEach(s => {
          if (parseInt(s.getAttribute('data-value')) <= value) {
            s.classList.add('active');
          } else {
            s.classList.remove('active');
          }
        });
      });
      
      star.addEventListener('mouseover', function() {
        const value = parseInt(this.getAttribute('data-value'));
        
        stars.forEach(s => {
          if (parseInt(s.getAttribute('data-value')) <= value) {
            s.classList.add('active');
          } else {
            s.classList.remove('active');
          }
        });
      });
      
      star.addEventListener('mouseout', function() {
        const currentRating = parseInt(ratingInput.value);
        
        stars.forEach(s => {
          if (parseInt(s.getAttribute('data-value')) <= currentRating) {
            s.classList.add('active');
          } else {
            s.classList.remove('active');
          }
        });
      });
    });
  
    // Save button click handler
    saveBtn.addEventListener('click', function() {
      const blogEntry = {
        url: urlInput.value,
        title: titleInput.value,
        author: authorInput.value,
        website: websiteInput.value,
        rating: parseInt(ratingInput.value) || 0,
        date: new Date().toISOString()
      };
  
      if (!blogEntry.url) {
        showMessage('URL is required', 'error');
        return;
      }
  
      // Save data to Chrome storage
      chrome.runtime.sendMessage({action: 'getBlogEntries'}, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Error getting blog entries:', chrome.runtime.lastError);
          showMessage('Error getting blog entries', 'error');
          return;
        }
        
        const blogEntries = response.blogEntries || [];
        console.log('Current blog entries:', blogEntries.length);
        
        // Check if this URL already exists
        const existingIndex = blogEntries.findIndex(entry => entry.url === blogEntry.url);
        
        const isUpdate = existingIndex !== -1;
        if (isUpdate) {
          // Update existing entry
          blogEntries[existingIndex] = blogEntry;
        } else {
          // Add new entry
          blogEntries.push(blogEntry);
        }

        console.log('Saving blog entries:', blogEntries.length);
        // Save to storage using background script
        saveBlogEntries(blogEntries, isUpdate ? 'Blog updated!' : 'Blog saved!');
      });
    });
  
    // Read Later button click handler
    readLaterBtn.addEventListener('click', function() {
      const toReadEntry = {
        url: urlInput.value,
        title: titleInput.value,
        author: authorInput.value,
        website: websiteInput.value,
        date: new Date().toISOString()
      };
      
      if (!toReadEntry.url) {
        showMessage('URL is required', 'error');
        return;
      }
      
      // Save to Chrome storage
      chrome.runtime.sendMessage({action: 'getToReadEntries'}, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Error getting to-read entries:', chrome.runtime.lastError);
          showMessage('Error getting to-read entries', 'error');
          return;
        }
        
        const toReadEntries = response.toReadEntries || [];
        
        // Check if URL already exists in to-read list
        const existingIndex = toReadEntries.findIndex(entry => entry.url === toReadEntry.url);
        
        if (existingIndex !== -1) {
          // URL already in read-later list
          showMessage('Already in your read-later list!', 'info');
        } else {
          // Add new entry
          toReadEntries.push(toReadEntry);

          // Save to storage using background script
          saveToReadEntries(toReadEntries);
        }
      });
    });
  
    // Randomizer functionality
    randomizer.addEventListener('click', function(e) {
      e.preventDefault();

      // Get the read later list using the background script
      chrome.runtime.sendMessage({action: 'getToReadEntries'}, function(response) {
        if (chrome.runtime.lastError) {
          showMessage('Error accessing read later list', 'error');
          return;
        }
        const toReadEntries = (response && response.toReadEntries) || [];
        
        if (toReadEntries.length === 0) {
          showMessage('No articles in your read later list!', 'info');
          return;
        }
        
        // Select a random article
        const randomIndex = Math.floor(Math.random() * toReadEntries.length);
        const randomArticle = toReadEntries[randomIndex];
        
        // Open the article in a new tab
        if (randomArticle && randomArticle.url) {
          chrome.tabs.create({url: randomArticle.url});
          window.close();
        } else {
          showMessage('Error finding article', 'error');
        }
      });
    });
  
    // Helper function to show messages
    function showMessage(message, type) {
      messageDiv.textContent = message;
      messageDiv.className = type;
      
      setTimeout(function() {
        messageDiv.textContent = '';
        messageDiv.className = '';
      }, 3000);
    }
    
    // Helper function to save blog entries
    function saveBlogEntries(blogEntries, successMessage) {
      if (!blogEntries || !Array.isArray(blogEntries)) {
        console.error('Invalid blog entries data:', blogEntries);
        showMessage('Error: Invalid data', 'error');
        return;
      }

      console.log('Sending saveBlogEntries message with', blogEntries.length, 'entries');
      chrome.runtime.sendMessage({
        action: 'saveBlogEntries',
        blogEntries: blogEntries
      }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Error in saveBlogEntries:', chrome.runtime.lastError);
          showMessage('Error saving blog entry: ' + chrome.runtime.lastError.message, 'error');
          return;
        }

        if (response && response.success) {
          console.log('Blog entries saved successfully');
          showMessage(successMessage || 'Blog saved!', 'success');
          setTimeout(function() {
            window.close();
          }, 1500);
        } else {
          console.error('Save failed:', response);
          showMessage('Error saving blog entry: ' + (response ? response.message : 'Unknown error'), 'error');
        }
      });
    }
    
    // Helper function to save to-read entries
    function saveToReadEntries(toReadEntries) {
      if (!toReadEntries || !Array.isArray(toReadEntries)) {
        console.error('Invalid to-read entries data:', toReadEntries);
        showMessage('Error: Invalid data', 'error');
        return;
      }

      chrome.runtime.sendMessage({
        action: 'saveToReadEntries',
        toReadEntries: toReadEntries
      }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Error in saveToReadEntries:', chrome.runtime.lastError);
          showMessage('Error saving to read entry: ' + chrome.runtime.lastError.message, 'error');
          return;
        }

        if (response && response.success) {
          showMessage('Added to read later!', 'success');
          setTimeout(function() {
            window.close();
          }, 1500);
        } else {
          console.error('Save failed:', response);
          showMessage('Error saving to read entry: ' + (response ? response.message : 'Unknown error'), 'error');
        }
      });
    }
  });