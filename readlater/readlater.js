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
      if (chrome.runtime.lastError) {
        console.error('Error loading to-read entries:', chrome.runtime.lastError);
        entriesListElement.innerHTML = '<p>Error loading entries. Please try again.</p>';
        return;
      }
      const toReadEntries = (response && response.toReadEntries) || [];

      // Always refresh the summary, including when the list just became empty --
      // otherwise removing the last item leaves stale counts on screen.
      updateStatsSummary(toReadEntries);

      if (toReadEntries.length === 0) {
        entriesListElement.innerHTML = '<p>No articles in your read later list yet!</p>';
        return;
      }

      // Initialize entries list
      updateEntriesList();
    });
  }

  // A pull from another device writes straight to the cache; re-render so the page
  // reflects what the phone did without needing a manual refresh.
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'local' && (changes.entriesV3 || changes.readsV3)) {
      loadToReadEntries();
    }
  });
  
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
          if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError); }
          resolve((response && response.toReadEntries) || []);
        });
      }),
      new Promise(resolve => {
        chrome.runtime.sendMessage({action: 'getBlogEntries'}, function(response) {
          if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError); }
          resolve((response && response.blogEntries) || []);
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
      if (chrome.runtime.lastError) {
        console.error('Error updating entries list:', chrome.runtime.lastError);
        return;
      }
      let toReadEntries = (response && response.toReadEntries) || [];
      
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
      
      // Mark read, with an inline star picker so you can rate without leaving the page
      const readBtn = document.createElement('button');
      readBtn.className = 'action-btn read-btn';
      readBtn.textContent = 'Mark read';
      readBtn.addEventListener('click', function() {
        toggleStarPicker(entryCard, entry, readBtn);
      });
      actionsElement.appendChild(readBtn);

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

  function toggleStarPicker(card, entry, btn) {
    const open = card.querySelector('.star-picker');
    if (open) {
      open.remove();
      btn.textContent = 'Mark read';
      return;
    }
    btn.textContent = 'Cancel';

    const picker = document.createElement('div');
    picker.className = 'star-picker';

    for (let v = 1; v <= 5; v++) {
      const s = document.createElement('span');
      s.className = 'picker-star';
      s.textContent = '★';
      s.title = `${v} star${v === 1 ? '' : 's'}`;
      s.addEventListener('mouseover', () => {
        picker.querySelectorAll('.picker-star').forEach((el, i) => {
          el.classList.toggle('active', i < v);
        });
      });
      s.addEventListener('click', () => moveToReadList(entry, v));
      picker.appendChild(s);
    }

    const skip = document.createElement('button');
    skip.className = 'action-btn';
    skip.textContent = 'No rating';
    skip.addEventListener('click', () => moveToReadList(entry, 0));
    picker.appendChild(skip);

    picker.addEventListener('mouseleave', () => {
      picker.querySelectorAll('.picker-star').forEach((el) => el.classList.remove('active'));
    });

    card.appendChild(picker);
  }

  function moveToReadList(entry, rating) {
    chrome.runtime.sendMessage({
      action: 'markRead',
      url: entry.url,
      title: entry.title,
      author: entry.author,
      website: entry.website,
      rating: rating
    }, function(response) {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        return;
      }
      if (!response || !response.success) {
        console.error('Mark read failed:', response);
        return;
      }
      // Marking it read moves it out of the queue on its own -- one row, one status.
      loadToReadEntries();
    });
  }

  function removeFromReadLater(url) {
    chrome.runtime.sendMessage({action: 'deleteEntry', url: url}, function(response) {
      if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError); return; }
      if (!response || !response.success) { console.error('Remove failed:', response); return; }
      loadToReadEntries();
    });
  }
  
  // Helper function for formatting display date
  function formatDisplayDate(date) {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }
}); 