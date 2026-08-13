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
    const rereadNotice = document.getElementById('reread-notice');
    const stars = document.querySelectorAll('.star');
    const randomizer = document.getElementById('randomizer');
    const openOptions = document.getElementById('open-options');

    // Set once we know this URL already has reads, so "Mark Read" logs a NEW read
    // event instead of editing the existing one. Re-reading an article on a later
    // date should light up both days on the heatmap.
    let knownReads = [];

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

      checkExistingReads(currentTab.url);
    });

    function checkExistingReads(url) {
      chrome.runtime.sendMessage({action: 'getReadsForUrl', url: url}, function(response) {
        if (chrome.runtime.lastError || !response) return;

        // Carry over metadata typed on a previous save so a re-read does not force
        // you to retype the author.
        if (response.entry) {
          if (!authorInput.value && response.entry.author) authorInput.value = response.entry.author;
          if (response.entry.title) titleInput.value = response.entry.title;
        }

        knownReads = response.reads || [];
        if (!knownReads.length) return;

        const last = knownReads[0];
        const when = formatDate(new Date(last.read_at));
        const stars = last.rating > 0 ? ' · ' + '★'.repeat(last.rating) : '';
        const times = knownReads.length > 1 ? ` (${knownReads.length} times)` : '';
        rereadNotice.textContent =
          `You read this on ${when}${stars}${times}. Saving adds a new read.`;
        rereadNotice.style.display = 'block';
        saveBtn.textContent = 'Mark Re-read';
      });
    }

    function formatDate(d) {
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

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
      if (!urlInput.value) {
        showMessage('URL is required', 'error');
        return;
      }

      saveBtn.disabled = true;
      chrome.runtime.sendMessage({
        action: 'markRead',
        url: urlInput.value,
        title: titleInput.value,
        author: authorInput.value,
        website: websiteInput.value,
        rating: parseInt(ratingInput.value) || 0,
        // Only ever true when we know there is an earlier read; a fresh save is
        // just a save, and a same-day double click is absorbed server-side.
        forceNewRead: knownReads.length > 0
      }, function(response) {
        saveBtn.disabled = false;

        if (chrome.runtime.lastError) {
          showMessage('Error saving: ' + chrome.runtime.lastError.message, 'error');
          return;
        }
        if (!response || !response.success) {
          showMessage('Error saving: ' + ((response && response.message) || 'Unknown error'), 'error');
          return;
        }

        showMessage(knownReads.length ? 'Re-read logged!' : 'Blog saved!', 'success');
        setTimeout(function() { window.close(); }, 1200);
      });
    });

    // Read Later button click handler
    readLaterBtn.addEventListener('click', function() {
      if (!urlInput.value) {
        showMessage('URL is required', 'error');
        return;
      }

      readLaterBtn.disabled = true;
      chrome.runtime.sendMessage({
        action: 'addToReadLater',
        url: urlInput.value,
        title: titleInput.value,
        author: authorInput.value,
        website: websiteInput.value
      }, function(response) {
        readLaterBtn.disabled = false;

        if (chrome.runtime.lastError) {
          showMessage('Error saving: ' + chrome.runtime.lastError.message, 'error');
          return;
        }
        if (!response || !response.success) {
          showMessage('Error saving: ' + ((response && response.message) || 'Unknown error'), 'error');
          return;
        }

        if (response.alreadyQueued) {
          showMessage('Already in your read-later list!', 'info');
          return;
        }
        if (response.alreadyRead) {
          showMessage("You've already read this one.", 'info');
          return;
        }

        showMessage('Added to read later!', 'success');
        setTimeout(function() { window.close(); }, 1200);
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

    openOptions.addEventListener('click', function(e) {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
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
