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
      chrome.storage.local.get('blogEntries', function(data) {
        const blogEntries = data.blogEntries || [];
        
        // Check if this URL already exists
        const existingIndex = blogEntries.findIndex(entry => entry.url === blogEntry.url);
        
        if (existingIndex !== -1) {
          // Update existing entry
          blogEntries[existingIndex] = blogEntry;
          showMessage('Blog updated!', 'success');
        } else {
          // Add new entry
          blogEntries.push(blogEntry);
          showMessage('Blog saved!', 'success');
        }
        
        // Save to storage
        chrome.storage.local.set({blogEntries: blogEntries}, function() {
          setTimeout(function() {
            window.close();
          }, 1500);
        });
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
      chrome.storage.local.get('toReadEntries', function(data) {
        const toReadEntries = data.toReadEntries || [];
        
        // Check if URL already exists in to-read list
        const existingIndex = toReadEntries.findIndex(entry => entry.url === toReadEntry.url);
        
        if (existingIndex !== -1) {
          // URL already in read-later list
          showMessage('Already in your read-later list!', 'info');
        } else {
          // Add new entry
          toReadEntries.push(toReadEntry);
          showMessage('Added to read later!', 'success');
          
          // Save to storage
          chrome.storage.local.set({toReadEntries: toReadEntries}, function() {
            setTimeout(function() {
              window.close();
            }, 1500);
          });
        }
      });
    });
  
    // Randomizer functionality
    randomizer.addEventListener('click', function(e) {
      e.preventDefault();
      
      // Get the read later list
      chrome.storage.local.get('toReadEntries', function(data) {
        const toReadEntries = data.toReadEntries || [];
        
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
  });