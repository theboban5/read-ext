document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const entriesListElement = document.getElementById('entries-list');
  const searchInput = document.getElementById('search-input');
  const sortSelect = document.getElementById('sort-select');
  const totalBlogsElement = document.getElementById('total-blogs');
  const uniqueWebsitesElement = document.getElementById('unique-websites');
  
  // Load read later entries
  loadToReadEntries();
  
  // Add event listeners for filtering and sorting
  searchInput.addEventListener('input', updateEntriesList);
  sortSelect.addEventListener('change', updateEntriesList);
  
  // Add event listener for stats modal
  document.getElementById('show-websites').addEventListener('click', showWebsitesModal);
  
  function loadToReadEntries() {
    chrome.runtime.sendMessage({action: 'getToReadEntries'}, function(response) {
      const toReadEntries = response.toReadEntries || [];
      
      if (toReadEntries.length === 0) {
        entriesListElement.innerHTML = '<p>No articles in your read later list yet!</p>';
        return;
      }
      
      // Update stats summary
      updateStatsSummary(toReadEntries);
      
      // Initialize entries list
      updateEntriesList();
    });
  }
  
  function updateStatsSummary(toReadEntries) {
    const totalBlogs = toReadEntries.length;
    
    // Get unique websites
    const uniqueWebsites = new Set();
    toReadEntries.forEach(entry => {
      if (entry.website && entry.website.trim() !== '') {
        uniqueWebsites.add(entry.website.trim().toLowerCase());
      }
    });
    
    // Update DOM
    totalBlogsElement.textContent = totalBlogs;
    uniqueWebsitesElement.textContent = uniqueWebsites.size;
  }
  
  function showWebsitesModal(e) {
    e.preventDefault();
    
    // Get both read later entries and blog entries
    Promise.all([
      new Promise(resolve => {
        chrome.runtime.sendMessage({action: 'getToReadEntries'}, function(response) {
          resolve(response.toReadEntries || []);
        });
      }),
      new Promise(resolve => {
        chrome.runtime.sendMessage({action: 'getBlogEntries'}, function(response) {
          resolve(response.blogEntries || []);
        });
      })
    ]).then(([toReadEntries, blogEntries]) => {
      const websiteCounts = {};
      const blogsByWebsite = {};
      const readStatsByWebsite = {};
      
      // Process read later entries
      toReadEntries.forEach(entry => {
        if (entry.website && entry.website.trim() !== '') {
          const key = entry.website.trim();
          websiteCounts[key] = (websiteCounts[key] || 0) + 1;
          if (!blogsByWebsite[key]) blogsByWebsite[key] = [];
          blogsByWebsite[key].push(entry);
        }
      });
      
      // Process previously read entries
      blogEntries.forEach(entry => {
        if (entry.website && entry.website.trim() !== '') {
          const key = entry.website.trim();
          if (!readStatsByWebsite[key]) {
            readStatsByWebsite[key] = {
              count: 0,
              totalRating: 0,
              avgRating: 0
            };
          }
          readStatsByWebsite[key].count++;
          if (entry.rating > 0) {
            readStatsByWebsite[key].totalRating += entry.rating;
          }
        }
      });
      
      // Calculate average ratings
      Object.keys(readStatsByWebsite).forEach(key => {
        const stats = readStatsByWebsite[key];
        if (stats.count > 0) {
          stats.avgRating = stats.totalRating / stats.count;
        }
      });
      
      const sortedWebsites = Object.entries(websiteCounts)
        .map(([name, count]) => ({
          name,
          count,
          readStats: readStatsByWebsite[name] || { count: 0, avgRating: 0 }
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      
      showModal('websites', sortedWebsites, blogsByWebsite);
    });
  }
  
  function showModal(type, items, blogsByKey) {
    const modal = document.getElementById('websites-modal');
    modal.innerHTML = `
      <div class="modal-content">
        <button class="modal-close" aria-label="Close">&times;</button>
        <h2>Websites</h2>
        <div class="toggle-list">
          ${items.map(item => {
            const blogs = (blogsByKey[item.name] || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
            const readStats = item.readStats;
            const readStatsHtml = readStats.count > 0 
              ? `<span style='color:#666;font-size:13px;margin-left:8px;'>
                   (Previously read: ${readStats.count}, Avg rating: ${readStats.avgRating.toFixed(1)}★)
                 </span>`
              : '';
            
            return `
              <details>
                <summary>
                  ${item.name} 
                  <span style='color:#888;font-size:13px;'>(${item.count} to read)</span>
                  ${readStatsHtml}
                </summary>
                <ul class='toggle-blogs'>
                  ${blogs.map(blog => {
                    let url = blog.url || '#';
                    let title = blog.title || 'Untitled';
                    return `<li><a href='${url}' class='toggle-link' target='_blank' rel='noopener'>${title}</a></li>`;
                  }).join('')}
                </ul>
              </details>
            `;
          }).join('')}
        </div>
      </div>
    `;
    modal.style.display = 'flex';
    
    // Close logic
    modal.querySelector('.modal-close').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
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