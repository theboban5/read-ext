document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const entriesListElement = document.getElementById('entries-list');
  const searchInput = document.getElementById('search-input');
  const sortSelect = document.getElementById('sort-select');
  
  // Load read later entries
  loadToReadEntries();
  
  // Add event listeners for filtering and sorting
  searchInput.addEventListener('input', updateEntriesList);
  sortSelect.addEventListener('change', updateEntriesList);
  
  function loadToReadEntries() {
    chrome.runtime.sendMessage({action: 'getToReadEntries'}, function(response) {
      const toReadEntries = response.toReadEntries || [];
      
      if (toReadEntries.length === 0) {
        entriesListElement.innerHTML = '<p>No articles in your read later list yet!</p>';
        return;
      }
      
      // Initialize entries list
      updateEntriesList();
    });
  }
  
  function updateEntriesList() {
    chrome.runtime.sendMessage({action: 'getToReadEntries'}, function(response) {
      let toReadEntries = response.toReadEntries || [];
      
      // Apply search filter
      const searchTerm = searchInput.value.toLowerCase().trim();
      if (searchTerm) {
        toReadEntries = toReadEntries.filter(entry => 
          (entry.title && entry.title.toLowerCase().includes(searchTerm)) ||
          (entry.author && entry.author.toLowerCase().includes(searchTerm)) ||
          (entry.website && entry.website.toLowerCase().includes(searchTerm))
        );
      }
      
      // Apply sorting
      const sortOption = sortSelect.value;
      
      switch (sortOption) {
        case 'date-desc':
          toReadEntries.sort((a, b) => new Date(b.date) - new Date(a.date));
          break;
        case 'date-asc':
          toReadEntries.sort((a, b) => new Date(a.date) - new Date(b.date));
          break;
        case 'website':
          toReadEntries.sort((a, b) => {
            const websiteA = (a.website || '').toLowerCase();
            const websiteB = (b.website || '').toLowerCase();
            return websiteA.localeCompare(websiteB);
          });
          break;
      }
      
      // Render entries list
      renderEntriesList(toReadEntries);
    });
  }
  
  function renderEntriesList(toReadEntries) {
    entriesListElement.innerHTML = '';
    
    if (toReadEntries.length === 0) {
      entriesListElement.innerHTML = '<p>No matching entries found.</p>';
      return;
    }
    
    toReadEntries.forEach(entry => {
      const entryCard = document.createElement('div');
      entryCard.className = 'entry-card';
      entryCard.dataset.url = entry.url;
      
      // Entry content container
      const entryContent = document.createElement('div');
      entryContent.className = 'entry-content';
      
      // Title 
      const titleElement = document.createElement('a');
      titleElement.className = 'entry-title';
      titleElement.href = entry.url;
      titleElement.target = '_blank';
      titleElement.textContent = entry.title || entry.url;
      entryContent.appendChild(titleElement);
      
      // Author and website info
      const infoElement = document.createElement('div');
      infoElement.className = 'entry-info';
      
      let infoText = '';
      if (entry.author) {
        infoText += `by ${entry.author}`;
      }
      
      if (entry.website) {
        infoText += infoText ? ` on ${entry.website}` : `on ${entry.website}`;
      }
      
      infoElement.textContent = infoText;
      entryContent.appendChild(infoElement);
      
      // Date
      const dateElement = document.createElement('div');
      dateElement.className = 'entry-date';
      dateElement.textContent = formatDisplayDate(new Date(entry.date));
      entryContent.appendChild(dateElement);
      
      entryCard.appendChild(entryContent);
      
      // Actions container
      const actionsElement = document.createElement('div');
      actionsElement.className = 'entry-actions';
      
      // Visit button
      const visitBtn = document.createElement('button');
      visitBtn.className = 'action-btn visit-btn';
      visitBtn.textContent = 'Visit';
      visitBtn.addEventListener('click', function() {
        window.open(entry.url, '_blank');
      });
      actionsElement.appendChild(visitBtn);
      
      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'action-btn remove-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function() {
        removeFromReadLater(entry.url);
      });
      actionsElement.appendChild(removeBtn);
      
      entryCard.appendChild(actionsElement);
      
      entriesListElement.appendChild(entryCard);
    });
  }
  
  function moveToReadList(entry) {
    // Create a blog entry with rating = 0
    const blogEntry = {
      url: entry.url,
      title: entry.title,
      author: entry.author,
      website: entry.website,
      rating: 0,
      date: new Date().toISOString()
    };
    
    // Add to blog entries
    chrome.storage.local.get('blogEntries', function(data) {
      let blogEntries = data.blogEntries || [];
      
      // Check if already exists
      const existingIndex = blogEntries.findIndex(item => item.url === blogEntry.url);
      if (existingIndex !== -1) {
        blogEntries[existingIndex] = blogEntry;
      } else {
        blogEntries.push(blogEntry);
      }
      
      // Save to storage and remove from read later
      chrome.storage.local.set({blogEntries: blogEntries}, function() {
        removeFromReadLater(entry.url);
      });
    });
  }
  
  function removeFromReadLater(url) {
    chrome.storage.local.get('toReadEntries', function(data) {
      let toReadEntries = data.toReadEntries || [];
      const newList = toReadEntries.filter(entry => entry.url !== url);
      
      chrome.storage.local.set({toReadEntries: newList}, function() {
        updateEntriesList();
      });
    });
  }
  
  // Helper function for formatting display date
  function formatDisplayDate(date) {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }
}); 