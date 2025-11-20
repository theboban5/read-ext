// Test 5-Star Articles Feature
// Run this in the browser console on the stats page

console.log('⭐ Testing 5-Star Articles Feature...');

// Test 1: Check if the element exists
function testElementExists() {
  console.log('\n📋 Test 1: Checking if elements exist...');
  
  const fiveStarCount = document.getElementById('five-star-count');
  const show5Star = document.getElementById('show-5star');
  const modal = document.getElementById('5star-modal');
  
  if (fiveStarCount) {
    console.log('✅ 5-star count element found');
    console.log(`   Current count: ${fiveStarCount.textContent}`);
  } else {
    console.log('❌ 5-star count element NOT found');
  }
  
  if (show5Star) {
    console.log('✅ Show 5-star button found');
  } else {
    console.log('❌ Show 5-star button NOT found');
  }
  
  if (modal) {
    console.log('✅ 5-star modal found');
  } else {
    console.log('❌ 5-star modal NOT found');
  }
  
  return fiveStarCount && show5Star && modal;
}

// Test 2: Check data
async function testData() {
  console.log('\n📊 Test 2: Checking 5-star articles data...');
  
  try {
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({action: 'getBlogEntries'}, resolve);
    });
    
    const blogEntries = response.blogEntries || [];
    const fiveStarArticles = blogEntries.filter(entry => entry.rating === 5);
    
    console.log(`✅ Total articles: ${blogEntries.length}`);
    console.log(`✅ 5-star articles: ${fiveStarArticles.length}`);
    
    if (fiveStarArticles.length > 0) {
      console.log('\n📝 Sample 5-star articles:');
      fiveStarArticles.slice(0, 3).forEach((article, index) => {
        console.log(`   ${index + 1}. ${article.title} (${article.author || 'Unknown author'})`);
      });
      if (fiveStarArticles.length > 3) {
        console.log(`   ... and ${fiveStarArticles.length - 3} more`);
      }
    } else {
      console.log('⚠️ No 5-star articles found');
      console.log('💡 Try rating some articles as 5 stars to test the feature');
    }
    
    return fiveStarArticles;
  } catch (error) {
    console.error('❌ Error getting blog entries:', error);
    return [];
  }
}

// Test 3: Test click functionality
function testClickFunctionality() {
  console.log('\n🖱️ Test 3: Testing click functionality...');
  
  const show5Star = document.getElementById('show-5star');
  
  if (!show5Star) {
    console.log('❌ Show 5-star button not found');
    return false;
  }
  
  console.log('✅ Button found, you can click it to test');
  console.log('💡 Click the "5 Star Articles" stat card to open the modal');
  
  return true;
}

// Test 4: Check if count matches data
async function testCountMatch() {
  console.log('\n🔢 Test 4: Checking if count matches data...');
  
  try {
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({action: 'getBlogEntries'}, resolve);
    });
    
    const blogEntries = response.blogEntries || [];
    const fiveStarArticles = blogEntries.filter(entry => entry.rating === 5);
    const displayedCount = document.getElementById('five-star-count')?.textContent || '0';
    
    console.log(`📊 Actual 5-star articles: ${fiveStarArticles.length}`);
    console.log(`📊 Displayed count: ${displayedCount}`);
    
    if (parseInt(displayedCount) === fiveStarArticles.length) {
      console.log('✅ Count matches!');
      return true;
    } else {
      console.log('❌ Count mismatch!');
      console.log('💡 Try refreshing the page');
      return false;
    }
  } catch (error) {
    console.error('❌ Error checking count:', error);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Running all tests...\n');
  
  const elementTest = testElementExists();
  const dataTest = await testData();
  const clickTest = testClickFunctionality();
  const countTest = await testCountMatch();
  
  console.log('\n📊 Test Summary:');
  console.log(`   Elements: ${elementTest ? '✅' : '❌'}`);
  console.log(`   Data: ${dataTest.length > 0 ? '✅' : '⚠️'}`);
  console.log(`   Click: ${clickTest ? '✅' : '❌'}`);
  console.log(`   Count Match: ${countTest ? '✅' : '❌'}`);
  
  if (elementTest && clickTest && countTest) {
    console.log('\n🎉 All tests passed! The feature should be working.');
    console.log('💡 Try clicking the "5 Star Articles" number to see the modal');
  } else {
    console.log('\n⚠️ Some tests failed. Make sure to:');
    console.log('   1. Reload the extension in chrome://extensions/');
    console.log('   2. Refresh the stats page');
    console.log('   3. Check the browser console for errors');
  }
}

// Run tests
runAllTests();

