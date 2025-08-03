// Manual URL Import Tool
// Run this in the browser console on the stats page

console.log('🔗 Manual URL Import Tool');
console.log('This tool helps import articles when URLs are missing from the text');

// Function to parse the plain text format
function parsePlainText(notesText) {
  console.log('🔍 Parsing plain text format...');
  
  const lines = notesText.split('\n').filter(line => line.trim() !== '');
  const articles = [];
  let currentArticle = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check if this line looks like a title (not rating, author, or date)
    const ratingMatch = line.match(/^[★☆]+$/);
    const authorMatch = line.match(/^by (.+?) on (.+)$/);
    const dateMatch = line.match(/^[A-Za-z]{3} \d{1,2}, \d{4}$/);
    
    if (!ratingMatch && !authorMatch && !dateMatch && line.length > 0) {
      // This might be a title line
      if (currentArticle) {
        articles.push(currentArticle);
      }
      
      // Start new article (without URL for now)
      currentArticle = {
        title: line,
        url: '', // Will be filled manually
        rating: 0,
        author: '',
        website: '',
        date: ''
      };
      continue;
    }
    
    // Check for rating line (★★★★☆ format)
    if (ratingMatch && currentArticle) {
      const stars = line.replace(/[^★]/g, '').length;
      currentArticle.rating = stars;
      continue;
    }
    
    // Check for author line (by Author on website format)
    if (authorMatch && currentArticle) {
      currentArticle.author = authorMatch[1].trim();
      currentArticle.website = authorMatch[2].trim();
      continue;
    }
    
    // Check for date line (MMM DD, YYYY format)
    if (dateMatch && currentArticle) {
      const date = new Date(line);
      if (!isNaN(date.getTime())) {
        currentArticle.date = date.toISOString();
      }
      continue;
    }
  }
  
  // Add the last article
  if (currentArticle) {
    articles.push(currentArticle);
  }
  
  console.log(`📊 Parsed ${articles.length} articles from plain text`);
  return articles;
}

// Function to manually add URLs
async function addUrlsManually(articles) {
  console.log('🔗 Adding URLs manually...');
  
  const articlesWithUrls = [];
  
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    
    console.log(`\n📝 Article ${i + 1}/${articles.length}:`);
    console.log(`Title: ${article.title}`);
    console.log(`Rating: ${article.rating}★`);
    console.log(`Author: ${article.author} on ${article.website}`);
    console.log(`Date: ${article.date}`);
    
    // Prompt for URL
    const url = prompt(`Enter URL for "${article.title}" (or press Cancel to skip):`);
    
    if (url && url.trim() !== '') {
      article.url = url.trim();
      articlesWithUrls.push(article);
      console.log(`✅ Added URL: ${url}`);
    } else {
      console.log(`⏭️ Skipped article: ${article.title}`);
    }
  }
  
  console.log(`\n📊 Successfully added URLs for ${articlesWithUrls.length}/${articles.length} articles`);
  return articlesWithUrls;
}

// Function to import articles to the extension
async function importArticles(articles) {
  console.log('💾 Importing articles to extension...');
  
  try {
    // Get current blog entries
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({action: 'getBlogEntries'}, resolve);
    });
    
    const currentEntries = response.blogEntries || [];
    console.log(`Current entries: ${currentEntries.length}`);
    
    // Create a set of existing URLs to avoid duplicates
    const existingUrls = new Set(currentEntries.map(entry => entry.url));
    
    // Filter out articles that already exist
    const newArticles = articles.filter(article => !existingUrls.has(article.url));
    
    console.log(`New articles to import: ${newArticles.length}`);
    
    if (newArticles.length === 0) {
      console.log('✅ All articles already exist in the extension!');
      return;
    }
    
    // Add new articles to current entries
    const updatedEntries = [...currentEntries, ...newArticles];
    
    // Send to background script to save
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'saveBlogEntries',
        blogEntries: updatedEntries
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          console.log('✅ Articles imported successfully!');
          resolve(response);
        }
      });
    });
    
    console.log(`🎉 Successfully imported ${newArticles.length} new articles!`);
    console.log('🔄 Please refresh the page to see your updated stats.');
    
  } catch (error) {
    console.error('❌ Error importing articles:', error);
  }
}

// Main import function for manual URL entry
window.manualImport = async function(notesText) {
  console.log('🚀 Starting manual import...');
  
  if (!notesText || notesText.trim() === '') {
    console.error('❌ No notes text provided');
    return;
  }
  
  try {
    // Parse the plain text
    const articles = parsePlainText(notesText);
    
    if (articles.length === 0) {
      console.log('❌ No articles found in the provided text');
      return;
    }
    
    console.log(`📋 Found ${articles.length} articles to process`);
    
    // Show preview
    console.log('\n📋 Preview of articles:');
    articles.slice(0, 3).forEach((article, index) => {
      console.log(`${index + 1}. ${article.title} (${article.rating}★) - ${article.author} on ${article.website}`);
    });
    
    if (articles.length > 3) {
      console.log(`... and ${articles.length - 3} more articles`);
    }
    
    // Confirm before starting manual URL entry
    if (confirm(`Found ${articles.length} articles. Start adding URLs manually?`)) {
      const articlesWithUrls = await addUrlsManually(articles);
      
      if (articlesWithUrls.length > 0) {
        if (confirm(`Import ${articlesWithUrls.length} articles with URLs?`)) {
          await importArticles(articlesWithUrls);
        } else {
          console.log('❌ Import cancelled');
        }
      } else {
        console.log('❌ No articles with URLs to import');
      }
    } else {
      console.log('❌ Manual URL entry cancelled');
    }
    
  } catch (error) {
    console.error('❌ Error during manual import:', error);
  }
};

// Instructions for user
console.log(`
🔗 HOW TO USE MANUAL IMPORT:
1. Copy your Apple Notes content (plain text is fine)
2. Run: manualImport(yourNotesText)
3. For each article, enter the URL when prompted
4. Confirm the import when done

💡 TIP: You can skip articles you don't want to import by pressing Cancel
💡 TIP: Keep your browser tabs open to copy URLs from the actual articles
`); 