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
      uniqueAuthorsElement.textContent = uniqueAuthors.size;
      uniqueWebsitesElement.textContent = uniqueWebsites.size;
      averageRatingElement.textContent = avgRating.toFixed(1);
    }
    
    function createActivityGraph(blogEntries) {
      // Get date range (last 365 days)
      const today = new Date();
      const oneYearAgo = new Date();
      oneYearAgo.setDate(today.getDate() - 365);
      
      // Create a map for counting blog entries by date
      const entriesByDate = new Map();
      
      // Initialize with empty counts
      for (let d = new Date(oneYearAgo); d <= today; d.setDate(d.getDate() + 1)) {
        const dateStr = formatDate(d);
        entriesByDate.set(dateStr, 0);
      }
      
      // Count entries by date
      blogEntries.forEach(entry => {
        const entryDate = new Date(entry.date);
        if (entryDate >= oneYearAgo && entryDate <= today) {
          const dateStr = formatDate(entryDate);
          entriesByDate.set(dateStr, (entriesByDate.get(dateStr) || 0) + 1);
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
        
        const dayCell = document.createElement('div');
        dayCell.className = 'day-cell';
        
        // Add level class based on count
        if (count > 0) {
          const level = Math.min(Math.ceil(count * 4 / maxCount), 4);
          dayCell.classList.add(`day-cell-level-${level}`);
          
          // Add tooltip
          dayCell.title = `${dateStr}: ${count} blog(s)`;
        } else {
          dayCell.title = dateStr + ": 0 blogs";
        }
        
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
  });