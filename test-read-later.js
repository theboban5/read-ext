// Test Read Later Functionality
// Run this in the browser console on the stats page

console.log('🧪 Testing read later functionality...');

// Test 1: Check current to-read entries
async function testCurrentToReadEntries() {
  console.log('📋 Test 1: Checking current to-read entries...');
  
  try {
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({action: 'getToReadEntries'}, resolve);
    });
    
    const toReadEntries = response.toReadEntries || [];
    console.log(`✅ Found ${toReadEntries.length} current to-read entries`);
    
    if (toReadEntries.length > 0) {
      console.log('📝 Sample entries:');
      toReadEntries.slice(0, 3).forEach((entry, index) => {
        console.log(`  ${index + 1}. ${entry.title} (${entry.website})`);
      });
    }
    
    return toReadEntries;
  } catch (error) {
    console.error('❌ Error getting to-read entries:', error);
    return [];
  }
}

// Test 2: Add a test entry
async function testAddToReadEntry() {
  console.log('\n📝 Test 2: Adding test entry to read later...');
  
  try {
    const testEntry = {
      url: 'https://example.com/test-article',
      title: 'Test Article for Read Later',
      author: 'Test Author',
      website: 'example.com',
      date: new Date().toISOString()
    };
    
    // Get current entries
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({action: 'getToReadEntries'}, resolve);
    });
    
    const currentEntries = response.toReadEntries || [];
    console.log(`📊 Current entries: ${currentEntries.length}`);
    
    // Add test entry
    const newEntries = [...currentEntries, testEntry];
    
    // Save to storage
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'saveToReadEntries',
        toReadEntries: newEntries
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
    
    console.log('✅ Test entry added successfully');
    
    // Verify it was saved
    const verifyResponse = await new Promise(resolve => {
      chrome.runtime.sendMessage({action: 'getToReadEntries'}, resolve);
    });
    
    const verifyEntries = verifyResponse.toReadEntries || [];
    console.log(`📊 Verified entries: ${verifyEntries.length}`);
    
    const testEntryFound = verifyEntries.find(entry => entry.url === testEntry.url);
    if (testEntryFound) {
      console.log('✅ Test entry found in storage');
    } else {
      console.log('❌ Test entry not found in storage');
    }
    
    return testEntryFound;
  } catch (error) {
    console.error('❌ Error adding test entry:', error);
    return false;
  }
}

// Test 3: Check storage location
async function testStorageLocation() {
  console.log('\n🏠 Test 3: Checking storage location...');
  
  try {
    const [localData, syncData] = await Promise.all([
      new Promise(resolve => chrome.storage.local.get(['toReadEntries', 'blogEntries'], resolve)),
      new Promise(resolve => chrome.storage.sync.get(['toReadEntries'], resolve))
    ]);
    
    const localToRead = localData.toReadEntries || [];
    const syncToRead = syncData.toReadEntries || [];
    const localBlogs = localData.blogEntries || [];
    
    console.log(`📊 Local storage - To-read: ${localToRead.length}, Blogs: ${localBlogs.length}`);
    console.log(`📊 Sync storage - To-read: ${syncToRead.length}`);
    
    if (localBlogs.length > 0 && localToRead.length > 0) {
      console.log('✅ Using local storage for both blogs and to-read entries');
    } else if (syncToRead.length > 0) {
      console.log('⚠️ Using sync storage for to-read entries');
    } else {
      console.log('❌ No to-read entries found in any storage');
    }
  } catch (error) {
    console.error('❌ Error checking storage location:', error);
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Running read later functionality tests...\n');
  
  await testCurrentToReadEntries();
  await testAddToReadEntry();
  await testStorageLocation();
  
  console.log('\n🎉 All tests completed!');
  console.log('💡 If all tests passed, read later functionality should be working');
}

// Run tests
runAllTests(); 