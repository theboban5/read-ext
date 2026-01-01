document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const totalBlogsElement = document.getElementById('total-blogs');
    const uniqueAuthorsElement = document.getElementById('unique-authors');
    const uniqueWebsitesElement = document.getElementById('unique-websites');
    const fiveStarCountElement = document.getElementById('five-star-count');
    const averageRatingElement = document.getElementById('average-rating');
    const activityGraphContainer = document.getElementById('activity-graph-container');
    const entriesListElement = document.getElementById('entries-list');
    const searchInput = document.getElementById('search-input');
    const sortSelect = document.getElementById('sort-select');
    
    // Store all blog entries globally
    let allBlogEntries = [];
    let selectedYear = null; // null means "last year"
    
    // Load blog entries
    loadBlogEntries();
    
    // Add event listeners for filtering and sorting
    searchInput.addEventListener('input', updateEntriesList);
    sortSelect.addEventListener('change', updateEntriesList);
    
    function loadBlogEntries() {
      chrome.runtime.sendMessage({action: 'getBlogEntries'}, function(response) {
        allBlogEntries = response.blogEntries || [];
        
        if (allBlogEntries.length === 0) {
          entriesListElement.innerHTML = '<p>No blog entries yet. Start tracking your reading!</p>';
          return;
        }
        
        // Create year filter buttons
        createYearFilters();
        
        // Update stats summary (default: last year)
        updateStatsSummary(allBlogEntries, selectedYear);
        
        // Create activity graph (default: last year)
        createActivityGraph(allBlogEntries, selectedYear);
        
        // Initialize entries list
        updateEntriesList();
      });
    }
    
    function createYearFilters() {
      // Get all unique years from blog entries
      const years = new Set();
      const today = new Date();
      const currentYear = today.getFullYear();
      
      allBlogEntries.forEach(entry => {
        if (entry.date) {
          const entryDate = new Date(entry.date);
          const year = entryDate.getFullYear();
          if (year <= currentYear) {
            years.add(year);
          }
        }
      });
      
      // Add current year if not present
      years.add(currentYear);
      
      // Sort years in descending order
      const sortedYears = Array.from(years).sort((a, b) => b - a);
      
      // Create year filter container
      const activityGraphSection = document.querySelector('.activity-graph');
      let yearFilterContainer = document.getElementById('year-filter-container');
      
      if (!yearFilterContainer) {
        yearFilterContainer = document.createElement('div');
        yearFilterContainer.id = 'year-filter-container';
        yearFilterContainer.className = 'year-filter-container';
        
        // Insert after the h2 heading
        const h2 = activityGraphSection.querySelector('h2');
        h2.insertAdjacentElement('afterend', yearFilterContainer);
      }
      
      yearFilterContainer.innerHTML = '';
      
      // Add "Last year" button
      const lastYearBtn = document.createElement('button');
      lastYearBtn.className = 'year-filter-btn active';
      lastYearBtn.textContent = 'Last year';
      lastYearBtn.dataset.year = '';
      lastYearBtn.addEventListener('click', function() {
        selectedYear = null;
        updateYearFilterButtons();
        updateStatsSummary(allBlogEntries, selectedYear);
        createActivityGraph(allBlogEntries, selectedYear);
      });
      yearFilterContainer.appendChild(lastYearBtn);
      
      // Add year buttons
      sortedYears.forEach(year => {
        const yearBtn = document.createElement('button');
        yearBtn.className = 'year-filter-btn';
        yearBtn.textContent = year.toString();
        yearBtn.dataset.year = year;
        yearBtn.addEventListener('click', function() {
          selectedYear = year;
          updateYearFilterButtons();
          updateStatsSummary(allBlogEntries, selectedYear);
          createActivityGraph(allBlogEntries, selectedYear);
        });
        yearFilterContainer.appendChild(yearBtn);
      });
      
      // Add "Total" button
      const totalBtn = document.createElement('button');
      totalBtn.className = 'year-filter-btn';
      totalBtn.textContent = 'Total';
      totalBtn.dataset.year = 'total';
      totalBtn.addEventListener('click', function() {
        selectedYear = 'total';
        updateYearFilterButtons();
        updateStatsSummary(allBlogEntries, selectedYear);
        createActivityGraph(allBlogEntries, selectedYear);
      });
      yearFilterContainer.appendChild(totalBtn);
    }
    
    function updateYearFilterButtons() {
      const buttons = document.querySelectorAll('.year-filter-btn');
      buttons.forEach(btn => {
        const btnYear = btn.dataset.year === '' ? null : (btn.dataset.year === 'total' ? 'total' : parseInt(btn.dataset.year));
        if (btnYear === selectedYear) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }
    
    function updateStatsSummary(blogEntries, yearFilter) {
      // Filter entries by year if specified
      let filteredEntries = blogEntries;
      const today = new Date();
      
      if (yearFilter === 'total') {
        // Show all entries (no filtering)
        filteredEntries = blogEntries;
      } else if (yearFilter !== null) {
        filteredEntries = blogEntries.filter(entry => {
          if (!entry.date) return false;
          const entryDate = new Date(entry.date);
          const entryYear = entryDate.getFullYear();
          if (entryYear !== yearFilter) return false;
          // If it's the current year, only include entries up to today
          if (yearFilter === today.getFullYear()) {
            return entryDate <= today;
          }
          return true;
        });
      } else {
        // Filter to last 365 days
        const oneYearAgo = new Date();
        oneYearAgo.setDate(today.getDate() - 365);
        filteredEntries = blogEntries.filter(entry => {
          if (!entry.date) return false;
          const entryDate = new Date(entry.date);
          return entryDate >= oneYearAgo && entryDate <= today;
        });
      }
      
      const totalBlogs = filteredEntries.length;
      
      // Get unique authors
      const uniqueAuthors = new Set();
      filteredEntries.forEach(entry => {
        if (entry.author && entry.author.trim() !== '') {
          uniqueAuthors.add(entry.author.trim().toLowerCase());
        }
      });
      
      // Get unique websites
      const uniqueWebsites = new Set();
      filteredEntries.forEach(entry => {
        if (entry.website && entry.website.trim() !== '') {
          uniqueWebsites.add(entry.website.trim().toLowerCase());
        }
      });
      
      // Calculate average rating
      const validRatings = filteredEntries.filter(entry => entry.rating > 0);
      const avgRating = validRatings.length > 0 
        ? validRatings.reduce((sum, entry) => sum + entry.rating, 0) / validRatings.length 
        : 0;
      
      // Count 5-star articles
      const fiveStarArticles = filteredEntries.filter(entry => entry.rating === 5);
      
      // Update DOM
      totalBlogsElement.textContent = totalBlogs;
      document.getElementById('unique-authors').textContent = uniqueAuthors.size;
      document.getElementById('unique-websites').textContent = uniqueWebsites.size;
      fiveStarCountElement.textContent = fiveStarArticles.length;
      averageRatingElement.textContent = avgRating.toFixed(1);
    }
    
    function createActivityGraph(blogEntries, yearFilter) {
      try {
        let startDate, endDate, titleText;
        const today = new Date();
        
        if (yearFilter === 'total') {
          // For "total", just show the last year view (same as "last year" filter)
          endDate = new Date(today);
          startDate = new Date(today);
          startDate.setDate(endDate.getDate() - 365);
          const totalReads = blogEntries.length;
          titleText = `${totalReads} read${totalReads === 1 ? '' : 's'} total`;
        } else if (yearFilter !== null) {
          // Filter to specific year - show full year (365/366 days)
          startDate = new Date(yearFilter, 0, 1); // January 1st of the year
          endDate = new Date(yearFilter, 11, 31, 23, 59, 59); // December 31st of the year
          const readsInYear = blogEntries.filter(entry => {
            if (!entry.date) return false;
            const entryDate = new Date(entry.date);
            return entryDate >= startDate && entryDate <= endDate;
          }).length;
          titleText = `${readsInYear} read${readsInYear === 1 ? '' : 's'} in ${yearFilter}`;
        } else {
          // Filter to last 365 days
          endDate = new Date(today);
          startDate = new Date(today);
          startDate.setDate(endDate.getDate() - 365);
          const readsLastYear = blogEntries.filter(entry => {
            if (!entry.date) return false;
            const entryDate = new Date(entry.date);
            return entryDate >= startDate && entryDate <= endDate;
          }).length;
          titleText = `${readsLastYear} read${readsLastYear === 1 ? '' : 's'} in the last year`;
        }
        
        // Update the activity graph heading
        const activityHeader = document.querySelector('#activity-graph-container').previousElementSibling;
        if (activityHeader && activityHeader.tagName === 'H2') {
          activityHeader.textContent = titleText;
        }
        
        // Create a map for counting blog entries by date
        const entriesByDate = new Map();
        // Create a map for storing blog entries by date
        const blogsByDate = new Map();
        
        // Initialize with empty counts and empty arrays for ALL days in the range
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
          const dateStr = formatDate(d);
          entriesByDate.set(dateStr, 0);
          blogsByDate.set(dateStr, []);
        }
        
        // Count entries by date and collect blogs
        if (Array.isArray(blogEntries)) {
          blogEntries.forEach(entry => {
            try {
              if (entry && entry.date) {
                const entryDate = new Date(entry.date);
                // Check if entry is within the date range (use startDate and endDate, not today)
                if (entryDate >= startDate && entryDate <= endDate) {
                  const dateStr = formatDate(entryDate);
                  
                  // Update count
                  entriesByDate.set(dateStr, (entriesByDate.get(dateStr) || 0) + 1);
                  
                  // Add to blogs array - make sure array exists
                  if (!blogsByDate.has(dateStr)) {
                    blogsByDate.set(dateStr, []);
                  }
                  
                  const blogsArray = blogsByDate.get(dateStr);
                  if (Array.isArray(blogsArray)) {
                    blogsArray.push(entry);
                  }
                }
              }
            } catch (err) {
              console.error('Error processing entry:', err);
            }
          });
        }
        
        // Find max count for scaling
        const maxCount = Math.max(...entriesByDate.values(), 1);
        
        // Create Github-style activity graph
        activityGraphContainer.innerHTML = '';
        
        // --- Add month labels row ---
        const monthLabelsDiv = document.createElement('div');
        monthLabelsDiv.className = 'month-labels';
        monthLabelsDiv.style.display = 'flex';
        monthLabelsDiv.style.marginLeft = '32px'; // align with graph
        monthLabelsDiv.style.marginBottom = '2px';
        monthLabelsDiv.style.height = '16px';
        monthLabelsDiv.style.fontSize = '11px';
        monthLabelsDiv.style.color = '#888';
        
        // Calculate weeks and months
        let months = [];
        let lastMonth = null;
        let d = new Date(startDate);
        let endDateCopy = new Date(endDate);
        let weekIndex = 0;
        let firstDayOfWeek = d.getDay();
        // Add empty label for alignment
        if (firstDayOfWeek > 0) {
          const emptyLabel = document.createElement('div');
          emptyLabel.style.width = `${firstDayOfWeek * 16}px`;
          emptyLabel.style.display = 'inline-block';
          monthLabelsDiv.appendChild(emptyLabel);
        }
        while (d <= endDateCopy) {
          const month = d.getMonth();
          if (month !== lastMonth) {
            // Add month label
            const monthLabel = document.createElement('div');
            monthLabel.textContent = d.toLocaleString('default', { month: 'short' });
            monthLabel.style.width = '56px'; // 7 days * 8px width per cell
            monthLabel.style.display = 'inline-block';
            monthLabelsDiv.appendChild(monthLabel);
            lastMonth = month;
          } else {
            // Add empty space for non-first week of month
            const empty = document.createElement('div');
            empty.style.width = '8px';
            empty.style.display = 'inline-block';
            monthLabelsDiv.appendChild(empty);
          }
          d.setDate(d.getDate() + 7 - d.getDay()); // jump to next week's first day
        }
        activityGraphContainer.appendChild(monthLabelsDiv);
        // --- End month labels row ---
        
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
        
        let currentDate = new Date(startDate);
        const startDay = currentDate.getDay();
        
        // Add empty cells for alignment
        for (let i = 0; i < startDay; i++) {
          const emptyCell = document.createElement('div');
          emptyCell.className = 'day-cell';
          emptyCell.style.visibility = 'hidden';
          graphDiv.appendChild(emptyCell);
        }
        
        // Add day cells - show all days in the range (including empty days)
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
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
            // Add blog count next to date
            tooltip.innerHTML = `<div class='tooltip-date'>${dateStr} <span style="color:#888;font-size:13px;">(${blogs.length} blog${blogs.length === 1 ? '' : 's'})</span></div>`;
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
      } catch (err) {
        console.error('Error creating activity graph:', err);
        activityGraphContainer.innerHTML = '<p>Error loading activity graph</p>';
      }
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
    
    // Helper function to filter blog entries by year filter
    function filterEntriesByYear(blogEntries, yearFilter) {
      const today = new Date();
      
      if (yearFilter === 'total') {
        // Show all entries (no filtering)
        return blogEntries;
      } else if (yearFilter !== null) {
        return blogEntries.filter(entry => {
          if (!entry.date) return false;
          const entryDate = new Date(entry.date);
          const entryYear = entryDate.getFullYear();
          if (entryYear !== yearFilter) return false;
          // If it's the current year, only include entries up to today
          if (yearFilter === today.getFullYear()) {
            return entryDate <= today;
          }
          return true;
        });
      } else {
        // Filter to last 365 days
        const oneYearAgo = new Date();
        oneYearAgo.setDate(today.getDate() - 365);
        return blogEntries.filter(entry => {
          if (!entry.date) return false;
          const entryDate = new Date(entry.date);
          return entryDate >= oneYearAgo && entryDate <= today;
        });
      }
    }
    
    // Modal logic for authors and websites
    function showModal(type, items, blogsByKey) {
      const modal = document.getElementById(type === 'authors' ? 'authors-modal' : 'websites-modal');
      // Helper to render a rating bar (0-5 scale)
      function renderRatingBar(rating) {
        const percent = Math.max(0, Math.min(100, (rating / 5) * 100));
        return `<span class='rating-bar-container' title='Average rating: ${rating.toFixed(2)}'>
          <span class='rating-bar-bg'></span>
          <span class='rating-bar-fill' style='width:${percent}%;'></span>
        </span>
        <span class='rating-bar-value'>${rating.toFixed(2)}/5</span>`;
      }
      // Compute stats for sorting
      const itemsWithStats = items.map(item => {
        const blogs = (blogsByKey[item.name] || []);
        let avgRating = 0;
        let fiveStarCount = 0;
        let lastRead = null;
        if (blogs.length > 0) {
          const sum = blogs.reduce((acc, b) => acc + (b.rating || 0), 0);
          avgRating = sum / blogs.length;
          fiveStarCount = blogs.filter(b => b.rating === 5).length;
          lastRead = blogs.reduce((latest, b) => {
            const d = b.date ? new Date(b.date) : null;
            return (!latest || (d && d > latest)) ? d : latest;
          }, null);
        }
        return {...item, avgRating, fiveStarCount, lastRead, blogs};
      });
      // Modal HTML with sort dropdown
      modal.innerHTML = `
        <div class="modal-content">
          <button class="modal-close" aria-label="Close">&times;</button>
          <h2>${type === 'authors' ? 'Authors' : 'Websites'}</h2>
          <div class="modal-sort-controls">
            <label for="modal-sort-select">Sort by:</label>
            <select id="modal-sort-select">
              <option value="most-read">Most Read</option>
              <option value="highest-avg">Highest Avg Rating</option>
              <option value="lowest-avg">Lowest Avg Rating</option>
              <option value="most-5star">Most 5★ Ratings</option>
              <option value="last-read">Last Read</option>
            </select>
          </div>
          <div class="toggle-list" id="modal-toggle-list"></div>
        </div>
      `;
      function renderList(sortType) {
        let sorted = [...itemsWithStats];
        switch (sortType) {
          case 'highest-avg':
            sorted.sort((a, b) => b.avgRating - a.avgRating || b.count - a.count || a.name.localeCompare(b.name));
            break;
          case 'lowest-avg':
            sorted.sort((a, b) => a.avgRating - b.avgRating || b.count - a.count || a.name.localeCompare(b.name));
            break;
          case 'most-5star':
            sorted.sort((a, b) => b.fiveStarCount - a.fiveStarCount || b.count - a.count || a.name.localeCompare(b.name));
            break;
          case 'last-read':
            sorted.sort((a, b) => {
              if (b.lastRead && a.lastRead) return b.lastRead - a.lastRead;
              if (b.lastRead) return 1;
              if (a.lastRead) return -1;
              return b.count - a.count || a.name.localeCompare(b.name);
            });
            break;
          case 'most-read':
          default:
            sorted.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        }
        document.getElementById('modal-toggle-list').innerHTML = sorted.map(item => {
          let avgBar = item.avgRating ? renderRatingBar(item.avgRating) : '';
          let lastReadStr = item.lastRead ? `<span class='last-read' title='Last read'>${item.lastRead.toLocaleDateString()}</span>` : '';
          return `
            <details>
              <summary>${item.name} <span style='color:#888;font-size:13px;'>(${item.count})</span> ${avgBar} <span class='five-star-count' title='5-star ratings'>${item.fiveStarCount > 0 ? '★'.repeat(item.fiveStarCount) : ''}</span> ${lastReadStr}</summary>
              <ul class='toggle-blogs'>
                ${item.blogs.map(blog => {
                  let rating = blog.rating ? renderRatingBar(blog.rating) : '';
                  let url = blog.url || '#';
                  let title = blog.title || 'Untitled';
                  return `<li><a href='${url}' class='toggle-link' target='_blank' rel='noopener'>${title}</a> ${rating}</li>`;
                }).join('')}
              </ul>
            </details>
          `;
        }).join('');
      }
      renderList('most-read');
      document.getElementById('modal-sort-select').onchange = function(e) {
        renderList(e.target.value);
      };
      modal.style.display = 'flex';
      // Close logic
      modal.querySelector('.modal-close').onclick = () => { modal.style.display = 'none'; };
      modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    }

    document.getElementById('show-authors').onclick = function(e) {
      e.preventDefault();
      // Filter entries by selected year
      const blogEntries = filterEntriesByYear(allBlogEntries, selectedYear);
      const authorCounts = {};
      const blogsByAuthor = {};
      blogEntries.forEach(entry => {
        if (entry.author && entry.author.trim() !== '') {
          // Split by comma, trim each author, and add the blog to each
          entry.author.split(/,|\/|\band\b/gi).map(a => a.trim()).forEach(authorName => {
            if (!authorName) return;
            authorCounts[authorName] = (authorCounts[authorName] || 0) + 1;
            if (!blogsByAuthor[authorName]) blogsByAuthor[authorName] = [];
            blogsByAuthor[authorName].push(entry);
          });
        }
      });
      const sortedAuthors = Object.entries(authorCounts)
        .map(([name, count]) => ({name, count}))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      showModal('authors', sortedAuthors, blogsByAuthor);
    };

    document.getElementById('show-websites').onclick = function(e) {
      e.preventDefault();
      // Filter entries by selected year
      const blogEntries = filterEntriesByYear(allBlogEntries, selectedYear);
      const websiteCounts = {};
      const blogsByWebsite = {};
      const websiteDisplayNames = {};
      blogEntries.forEach(entry => {
        if (entry.website && entry.website.trim() !== '') {
          const key = entry.website.trim().toLowerCase();
          websiteCounts[key] = (websiteCounts[key] || 0) + 1;
          if (!blogsByWebsite[key]) blogsByWebsite[key] = [];
          blogsByWebsite[key].push(entry);
          // Store the display name (first encountered)
          if (!websiteDisplayNames[key]) websiteDisplayNames[key] = entry.website.trim();
        }
      });
      const sortedWebsites = Object.entries(websiteCounts)
        .map(([key, count]) => ({name: websiteDisplayNames[key], count}))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      showModal('websites', sortedWebsites, blogsByWebsite);
    };

    document.getElementById('show-5star').onclick = function(e) {
      e.preventDefault();
      // Filter entries by selected year
      const blogEntries = filterEntriesByYear(allBlogEntries, selectedYear);
      const fiveStarArticles = blogEntries.filter(entry => entry.rating === 5);
      
      // Sort by date (most recent first)
      fiveStarArticles.sort((a, b) => {
        const dateA = a.date ? new Date(a.date) : new Date(0);
        const dateB = b.date ? new Date(b.date) : new Date(0);
        return dateB - dateA;
      });
      
      // Create modal content
      const modal = document.getElementById('5star-modal');
      modal.innerHTML = `
        <div class="modal-content">
          <button class="modal-close" aria-label="Close">&times;</button>
          <h2>5 Star Articles (${fiveStarArticles.length})</h2>
          <div class="five-star-list">
            ${fiveStarArticles.length > 0 ? 
              fiveStarArticles.map(entry => {
                const date = entry.date ? new Date(entry.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown date';
                const author = entry.author ? `by ${entry.author}` : '';
                const website = entry.website ? `on ${entry.website}` : '';
                const info = [author, website].filter(Boolean).join(' ');
                return `
                  <div class="five-star-entry">
                    <a href="${entry.url || '#'}" class="five-star-title" target="_blank" rel="noopener">${entry.title || 'Untitled'}</a>
                    <div class="five-star-info">${info}</div>
                    <div class="five-star-date">${date}</div>
                  </div>
                `;
              }).join('') :
              '<p>No 5-star articles yet. Keep reading!</p>'
            }
          </div>
        </div>
      `;
      
      // Close logic
      modal.querySelector('.modal-close').onclick = () => { modal.style.display = 'none'; };
      modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
      modal.style.display = 'flex';
    };

    // Backup functionality
    document.getElementById('create-backup').onclick = function(e) {
      e.preventDefault();
      const btn = this;
      btn.disabled = true;
      btn.textContent = 'Creating Backup...';
      
      chrome.runtime.sendMessage({action: 'createBackup'}, function(response) {
        btn.disabled = false;
        btn.textContent = 'Create Backup';
        
        if (response.success) {
          alert('Backup created successfully! Check your Downloads folder.');
        } else {
          alert('Backup failed: ' + response.message);
        }
      });
    };

    document.getElementById('restore-backup').onclick = function(e) {
      e.preventDefault();
      document.getElementById('restore-file').click();
    };

    document.getElementById('restore-file').onchange = function(e) {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(e) {
        const fileContent = e.target.result;
        
        if (confirm('This will replace all your current data. Are you sure you want to restore from backup?')) {
          chrome.runtime.sendMessage({
            action: 'restoreBackup',
            fileContent: fileContent
          }, function(response) {
            if (response.success) {
              alert('Backup restored successfully! The page will reload.');
              window.location.reload();
            } else {
              alert('Restore failed: ' + response.message);
            }
          });
        }
      };
      reader.readAsText(file);
      
      // Reset the file input
      e.target.value = '';
    };
  });