document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const totalBlogsElement = document.getElementById('total-blogs');
    const uniqueAuthorsElement = document.getElementById('unique-authors');
    const uniqueWebsitesElement = document.getElementById('unique-websites');
    const averageRatingElement = document.getElementById('average-rating');
    const activityGraphContainer = document.getElementById('activity-graph-container');
    const entriesListElement = document.getElementById('entries-list');
    const searchInput = document.getElementById('search-input');
    const sortSelect = document.getElementById('sort-select');
    
    // Load blog entries
    loadBlogEntries();
    
    // Add event listeners for filtering and sorting
    searchInput.addEventListener('input', updateEntriesList);
    sortSelect.addEventListener('change', updateEntriesList);
    
    function loadBlogEntries() {
      chrome.runtime.sendMessage({action: 'getBlogEntries'}, function(response) {
        const blogEntries = response.blogEntries || [];
        
        if (blogEntries.length === 0) {
          entriesListElement.innerHTML = '<p>No blog entries yet. Start tracking your reading!</p>';
          return;
        }
        
        // Update stats summary
        updateStatsSummary(blogEntries);
        
        // Create activity graph
        createActivityGraph(blogEntries);
        
        // Initialize entries list
        updateEntriesList();
      });
    }
    
    function updateStatsSummary(blogEntries) {
      const totalBlogs = blogEntries.length;
      
      // Get unique authors
      const uniqueAuthors = new Set();
      blogEntries.forEach(entry => {
        if (entry.author && entry.author.trim() !== '') {
          uniqueAuthors.add(entry.author.trim().toLowerCase());
        }
      });
      
      // Get unique websites
      const uniqueWebsites = new Set();
      blogEntries.forEach(entry => {
        if (entry.website && entry.website.trim() !== '') {
          uniqueWebsites.add(entry.website.trim().toLowerCase());
        }
      });
      
      // Calculate average rating
      const validRatings = blogEntries.filter(entry => entry.rating > 0);
      const avgRating = validRatings.length > 0 
        ? validRatings.reduce((sum, entry) => sum + entry.rating, 0) / validRatings.length 
        : 0;
      
      // Update DOM
      totalBlogsElement.textContent = totalBlogs;
      document.getElementById('unique-authors').textContent = uniqueAuthors.size;
      document.getElementById('unique-websites').textContent = uniqueWebsites.size;
      averageRatingElement.textContent = avgRating.toFixed(1);
    }
    
    function createActivityGraph(blogEntries) {
      // Get date range (last 365 days)
      const today = new Date();
      const oneYearAgo = new Date();
      oneYearAgo.setDate(today.getDate() - 365);
      
      // Create a map for counting blog entries by date
      const entriesByDate = new Map();
      // Create a map for storing blog entries by date
      const blogsByDate = new Map();
      
      // Initialize with empty counts and empty arrays
      for (let d = new Date(oneYearAgo); d <= today; d.setDate(d.getDate() + 1)) {
        const dateStr = formatDate(d);
        entriesByDate.set(dateStr, 0);
        blogsByDate.set(dateStr, []);
      }
      
      // Count entries by date and collect blogs
      blogEntries.forEach(entry => {
        const entryDate = new Date(entry.date);
        if (entryDate >= oneYearAgo && entryDate <= today) {
          const dateStr = formatDate(entryDate);
          entriesByDate.set(dateStr, (entriesByDate.get(dateStr) || 0) + 1);
          blogsByDate.get(dateStr).push(entry);
        }
      });
      
      // Find max count for scaling
      const maxCount = Math.max(...entriesByDate.values(), 1);
      
      // Create Github-style activity graph
      activityGraphContainer.innerHTML = '';
      
      // Create days of week labels
      const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayLabelsDiv = document.createElement('div');
      dayLabelsDiv.className = 'day-labels';
      dayLabelsDiv.style.display = 'flex';
      dayLabelsDiv.style.flexDirection = 'column';
      dayLabelsDiv.style.marginRight = '5px';
      
      // Add empty space for alignment
      const emptyLabel = document.createElement('div');
      emptyLabel.style.height = '18px';
      dayLabelsDiv.appendChild(emptyLabel);
      
      // Add day labels
      daysOfWeek.forEach(day => {
        const dayLabel = document.createElement('div');
        dayLabel.style.height = '18px';
        dayLabel.style.fontSize = '10px';
        dayLabel.style.color = '#999';
        dayLabel.textContent = day;
        dayLabelsDiv.appendChild(dayLabel);
      });
      
      const graphWrapper = document.createElement('div');
      graphWrapper.style.display = 'flex';
      
      graphWrapper.appendChild(dayLabelsDiv);
      
      const graphDiv = document.createElement('div');
      graphDiv.style.display = 'flex';
      graphDiv.style.flexWrap = 'wrap';
      graphDiv.style.width = '100%';
      
      let currentDate = new Date(oneYearAgo);
      const startDay = currentDate.getDay();
      
      // Add empty cells for alignment
      for (let i = 0; i < startDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'day-cell';
        emptyCell.style.visibility = 'hidden';
        graphDiv.appendChild(emptyCell);
      }
      
      // Add day cells
      for (let d = new Date(oneYearAgo); d <= today; d.setDate(d.getDate() + 1)) {
        const dateStr = formatDate(d);
        const count = entriesByDate.get(dateStr) || 0;
        const blogs = blogsByDate.get(dateStr) || [];
        
        const dayCell = document.createElement('div');
        dayCell.className = 'day-cell';
        dayCell.dataset.date = dateStr;
        
        // Add level class based on count
        if (count > 0) {
          const level = Math.min(Math.ceil(count * 4 / maxCount), 4);
          dayCell.classList.add(`day-cell-level-${level}`);
        }
        
        // Custom tooltip logic
        dayCell.addEventListener('mouseenter', function(e) {
          let tooltip = document.createElement('div');
          tooltip.className = 'custom-tooltip';
          tooltip.style.left = (e.clientX + 10) + 'px';
          tooltip.style.top = (e.clientY + 10) + 'px';
          tooltip.innerHTML = `<div class='tooltip-date'>${dateStr}</div>`;
          if (blogs.length > 0) {
            tooltip.innerHTML += `<ul class='tooltip-list'>` + blogs.map((entry, idx) => {
              let title = entry.title || 'Untitled';
              let author = entry.author ? ` <span class='tooltip-author'>&mdash; ${entry.author}</span>` : '';
              let rating = entry.rating ? `<span class='tooltip-rating'>${'★'.repeat(entry.rating)}${'☆'.repeat(5 - entry.rating)}</span>` : '';
              let url = entry.url || '#';
              return `<li><a href='${url}' class='tooltip-link' target='_blank' rel='noopener'>${title}</a>${author} ${rating}</li>`;
            }).join('') + `</ul>`;
          } else {
            tooltip.innerHTML += `<div class='tooltip-empty'>No blogs</div>`;
          }
          document.body.appendChild(tooltip);
          dayCell._tooltip = tooltip;

          // Tooltip hover logic
          let hideTimeout;
          const removeTooltip = () => {
            if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
            dayCell._tooltip = null;
          };
          dayCell._hideTooltip = () => {
            hideTimeout = setTimeout(removeTooltip, 100);
          };
          dayCell._clearHideTooltip = () => {
            if (hideTimeout) clearTimeout(hideTimeout);
          };
          dayCell.addEventListener('mouseleave', dayCell._hideTooltip);
          tooltip.addEventListener('mouseenter', dayCell._clearHideTooltip);
          tooltip.addEventListener('mouseleave', dayCell._hideTooltip);
        });
        dayCell.addEventListener('mousemove', function(e) {
          if (dayCell._tooltip) {
            dayCell._tooltip.style.left = (e.clientX + 10) + 'px';
            dayCell._tooltip.style.top = (e.clientY + 10) + 'px';
          }
        });
        graphDiv.appendChild(dayCell);
      }
      
      graphWrapper.appendChild(graphDiv);
      activityGraphContainer.appendChild(graphWrapper);
    }
    
    function updateEntriesList() {
      chrome.runtime.sendMessage({action: 'getBlogEntries'}, function(response) {
        let blogEntries = response.blogEntries || [];
        
        // Apply search filter
        const searchTerm = searchInput.value.toLowerCase().trim();
        if (searchTerm) {
          blogEntries = blogEntries.filter(entry => 
            (entry.title && entry.title.toLowerCase().includes(searchTerm)) ||
            (entry.author && entry.author.toLowerCase().includes(searchTerm)) ||
            (entry.website && entry.website.toLowerCase().includes(searchTerm))
          );
        }
        
        // Apply sorting
        const sortOption = sortSelect.value;
        
        switch (sortOption) {
          case 'date-desc':
            blogEntries.sort((a, b) => new Date(b.date) - new Date(a.date));
            break;
          case 'date-asc':
            blogEntries.sort((a, b) => new Date(a.date) - new Date(b.date));
            break;
          case 'rating-desc':
            blogEntries.sort((a, b) => b.rating - a.rating);
            break;
          case 'rating-asc':
            blogEntries.sort((a, b) => a.rating - b.rating);
            break;
        }
        
        // Render entries list
        renderEntriesList(blogEntries);
      });
    }
    
    function renderEntriesList(blogEntries) {
      entriesListElement.innerHTML = '';
      
      if (blogEntries.length === 0) {
        entriesListElement.innerHTML = '<p>No matching entries found.</p>';
        return;
      }
      
      blogEntries.forEach(entry => {
        const entryCard = document.createElement('div');
        entryCard.className = 'entry-card';
        
        const entryHeader = document.createElement('div');
        entryHeader.className = 'entry-header';
        
        // Title with link
        const titleElement = document.createElement('a');
        titleElement.className = 'entry-title';
        titleElement.href = entry.url;
        titleElement.target = '_blank';
        titleElement.textContent = entry.title || 'Untitled';
        entryHeader.appendChild(titleElement);
        
        // Rating stars
        const ratingElement = document.createElement('div');
        ratingElement.className = 'entry-rating';
        ratingElement.textContent = '★'.repeat(entry.rating) + '☆'.repeat(5 - entry.rating);
        entryHeader.appendChild(ratingElement);
        
        entryCard.appendChild(entryHeader);
        
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
        entryCard.appendChild(infoElement);
        
        // Date
        const dateElement = document.createElement('div');
        dateElement.className = 'entry-date';
        dateElement.textContent = formatDisplayDate(new Date(entry.date));
        entryCard.appendChild(dateElement);
        
        entriesListElement.appendChild(entryCard);
      });
    }
    
    // Helper function for formatting date (YYYY-MM-DD)
    function formatDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    
    // Helper function for formatting display date
    function formatDisplayDate(date) {
      const options = { year: 'numeric', month: 'short', day: 'numeric' };
      return date.toLocaleDateString('en-US', options);
    }
    
    // Modal logic for authors and websites
    function showModal(type, items, blogsByKey) {
      const modal = document.getElementById(type === 'authors' ? 'authors-modal' : 'websites-modal');
      modal.innerHTML = `
        <div class="modal-content">
          <button class="modal-close" aria-label="Close">&times;</button>
          <h2>${type === 'authors' ? 'Authors' : 'Websites'}</h2>
          <div class="toggle-list">
            ${items.map(item => {
              const blogs = (blogsByKey[item.name] || []).slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
              // Calculate average rating
              let avgRating = 0;
              if (blogs.length > 0) {
                const sum = blogs.reduce((acc, b) => acc + (b.rating || 0), 0);
                avgRating = sum / blogs.length;
              }
              // Half-star logic
              function renderStars(rating) {
                const fullStars = Math.floor(rating);
                const halfStar = rating - fullStars >= 0.25 && rating - fullStars < 0.75 ? 1 : 0;
                const emptyStars = 5 - fullStars - halfStar;
                return '★'.repeat(fullStars) + (halfStar ? '⯨' : '') + '☆'.repeat(emptyStars);
              }
              let avgStars = avgRating ? `<span class='toggle-rating' title='Average rating'>${renderStars(avgRating)}</span>` : '';
              return `
                <details>
                  <summary>${item.name} <span style='color:#888;font-size:13px;'>(${item.count})</span> ${avgStars}</summary>
                  <ul class='toggle-blogs'>
                    ${blogs.map(blog => {
                      let rating = blog.rating ? `<span class='toggle-rating'>${'★'.repeat(blog.rating)}${'☆'.repeat(5 - blog.rating)}</span>` : '';
                      let url = blog.url || '#';
                      let title = blog.title || 'Untitled';
                      return `<li><a href='${url}' class='toggle-link' target='_blank' rel='noopener'>${title}</a> ${rating}</li>`;
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

    document.getElementById('show-authors').onclick = function(e) {
      e.preventDefault();
      chrome.runtime.sendMessage({action: 'getBlogEntries'}, function(response) {
        const blogEntries = response.blogEntries || [];
        const authorCounts = {};
        const blogsByAuthor = {};
        blogEntries.forEach(entry => {
          if (entry.author && entry.author.trim() !== '') {
            const key = entry.author.trim();
            authorCounts[key] = (authorCounts[key] || 0) + 1;
            if (!blogsByAuthor[key]) blogsByAuthor[key] = [];
            blogsByAuthor[key].push(entry);
          }
        });
        const sortedAuthors = Object.entries(authorCounts)
          .map(([name, count]) => ({name, count}))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        showModal('authors', sortedAuthors, blogsByAuthor);
      });
    };

    document.getElementById('show-websites').onclick = function(e) {
      e.preventDefault();
      chrome.runtime.sendMessage({action: 'getBlogEntries'}, function(response) {
        const blogEntries = response.blogEntries || [];
        const websiteCounts = {};
        const blogsByWebsite = {};
        blogEntries.forEach(entry => {
          if (entry.website && entry.website.trim() !== '') {
            const key = entry.website.trim();
            websiteCounts[key] = (websiteCounts[key] || 0) + 1;
            if (!blogsByWebsite[key]) blogsByWebsite[key] = [];
            blogsByWebsite[key].push(entry);
          }
        });
        const sortedWebsites = Object.entries(websiteCounts)
          .map(([name, count]) => ({name, count}))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        showModal('websites', sortedWebsites, blogsByWebsite);
      });
    };
  });