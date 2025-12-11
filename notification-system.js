/* =========================================================
   REAL-TIME NOTIFICATION SYSTEM FOR AMS2 RACING LEAGUE
   Tracks updates and shows visual notifications for changes
   ========================================================= */

/* -----------------------------
   PART 1: Data Structure & Firebase Setup
   ----------------------------- */

// Store last seen timestamps for each user
let USER_LAST_SEEN = {
  leaderboard: null,
  roundResults: {},      // { 'S3-R5': timestamp }
  driverProfiles: {},    // { 'driverName': timestamp }
  driverEquipment: {},   // { 'driverName': timestamp }
  setupRounds: {}        // { 'S3-R5': timestamp }
};

// Track what has updates (for notification badges)
let PENDING_UPDATES = {
  leaderboard: false,
  roundResults: new Set(),     // Set of round keys like 'S3-R5'
  driverProfiles: new Set(),   // Set of driver names
  driverEquipment: new Set(),  // Set of driver names
  setupRounds: new Set()       // Set of round keys
};

/* -----------------------------
   PART 2: Initialize Last Seen Tracking
   ----------------------------- */

async function initializeNotificationSystem() {
  if (!currentUser) return;
  
  console.log('🔔 Initializing notification system for', currentUser.name);
  
  // Load user's last seen timestamps from Firebase
  const userKey = encodeKey(currentUser.name);
  const lastSeenRef = window.firebaseRef(window.firebaseDB, `User_Last_Seen/${userKey}`);
  
  try {
    const snapshot = await window.firebaseGet(lastSeenRef);
    const savedLastSeen = snapshot.val();
    
    if (savedLastSeen) {
      USER_LAST_SEEN = savedLastSeen;
      console.log('✅ Loaded last seen data:', USER_LAST_SEEN);
    } else {
      // First time user - set current timestamp for everything
      USER_LAST_SEEN = {
        leaderboard: Date.now(),
        roundResults: {},
        driverProfiles: {},
        driverEquipment: {},
        setupRounds: {}
      };
      await saveLastSeenTimestamps();
    }
    
    // Start listening for changes
    startListeningForUpdates();
    
  } catch (err) {
    console.error('❌ Error loading last seen data:', err);
  }
}

async function saveLastSeenTimestamps() {
  if (!currentUser) return;
  
  const userKey = encodeKey(currentUser.name);
  const lastSeenRef = window.firebaseRef(window.firebaseDB, `User_Last_Seen/${userKey}`);
  
  try {
    await window.firebaseSet(lastSeenRef, USER_LAST_SEEN);
    console.log('💾 Saved last seen timestamps');
  } catch (err) {
    console.error('❌ Error saving last seen data:', err);
  }
}

/* -----------------------------
   PART 3: Listen for Real-Time Updates
   ----------------------------- */

function startListeningForUpdates() {
  console.log('👂 Starting to listen for updates...');
  
  // Listen to Round_Data changes
  const roundDataRef = window.firebaseRef(window.firebaseDB, 'Round_Data');
  window.firebaseOnValue(roundDataRef, (snapshot) => {
    checkForRoundResultUpdates(snapshot.val());
  });
  
  // Listen to Driver_Profiles changes
  const profilesRef = window.firebaseRef(window.firebaseDB, 'Driver_Profiles');
  window.firebaseOnValue(profilesRef, (snapshot) => {
    checkForProfileUpdates(snapshot.val());
  });
  
  // Listen to Round Setup changes
  const setupRef = window.firebaseRef(window.firebaseDB, 'Form_responses_2');
  window.firebaseOnValue(setupRef, (snapshot) => {
    checkForSetupUpdates(snapshot.val());
  });
  
  // Listen to Leaderboard changes
  const leaderboardRef = window.firebaseRef(window.firebaseDB, 'Leaderboard');
  window.firebaseOnValue(leaderboardRef, (snapshot) => {
    checkForLeaderboardUpdates(snapshot.val());
  });
}

/* -----------------------------
   PART 4: Check Functions (Detect What Changed)
   ----------------------------- */

function checkForRoundResultUpdates(roundData) {
  if (!currentUser || !roundData) return;
  
  const roundArray = toArray(roundData);
  
  roundArray.forEach(result => {
    if (!result || !result.Season || !result.Round) return;
    
    const roundKey = `S${result.Season}-R${result.Round}`;
    const resultTimestamp = new Date(result.Last_Modified || result.Timestamp).getTime();
    
    // Check if this round has been updated since user last viewed it
    const lastSeen = USER_LAST_SEEN.roundResults[roundKey] || 0;
    
    if (resultTimestamp > lastSeen) {
      PENDING_UPDATES.roundResults.add(roundKey);
      console.log(`🔔 New update detected in ${roundKey}`);
    }
  });
  
  updateNotificationBadges();
}

function checkForProfileUpdates(profilesData) {
  if (!currentUser || !profilesData) return;
  
  const profilesArray = toArray(profilesData);
  
  profilesArray.forEach(profile => {
    if (!profile || !profile.Name) return;
    
    const driverName = profile.Name;
    const profileTimestamp = new Date(profile.Last_Modified || Date.now()).getTime();
    const lastSeen = USER_LAST_SEEN.driverProfiles[driverName] || 0;
    
    if (profileTimestamp > lastSeen) {
      PENDING_UPDATES.driverProfiles.add(driverName);
      console.log(`🔔 Profile update detected for ${driverName}`);
    }
    
    // Check equipment separately
    if (profile.equipment && profile.equipment_last_modified) {
      const equipTimestamp = new Date(profile.equipment_last_modified).getTime();
      const equipLastSeen = USER_LAST_SEEN.driverEquipment[driverName] || 0;
      
      if (equipTimestamp > equipLastSeen) {
        PENDING_UPDATES.driverEquipment.add(driverName);
        console.log(`🔔 Equipment update detected for ${driverName}`);
      }
    }
  });
  
  updateNotificationBadges();
}

function checkForSetupUpdates(setupData) {
  if (!currentUser || !setupData) return;
  
  const setupArray = toArray(setupData);
  
  setupArray.forEach(setup => {
    if (!setup || !setup.Season || !setup.Round_Number) return;
    
    const roundKey = `S${setup.Season}-R${setup.Round_Number}`;
    const setupTimestamp = new Date(setup.Timestamp).getTime();
    const lastSeen = USER_LAST_SEEN.setupRounds[roundKey] || 0;
    
    if (setupTimestamp > lastSeen) {
      PENDING_UPDATES.setupRounds.add(roundKey);
      console.log(`🔔 New round setup detected: ${roundKey}`);
    }
  });
  
  updateNotificationBadges();
}

function checkForLeaderboardUpdates(leaderboardData) {
  if (!currentUser || !leaderboardData) return;
  
  // Simple approach: if ANY leaderboard entry is newer than last seen
  const leaderboardArray = toArray(leaderboardData);
  const lastSeen = USER_LAST_SEEN.leaderboard || 0;
  
  const hasUpdate = leaderboardArray.some(entry => {
    if (!entry || !entry.Last_Modified) return false;
    const entryTime = new Date(entry.Last_Modified).getTime();
    return entryTime > lastSeen;
  });
  
  if (hasUpdate) {
    PENDING_UPDATES.leaderboard = true;
    console.log('🔔 Leaderboard update detected');
  }
  
  updateNotificationBadges();
}

/* -----------------------------
   PART 5: Visual Notification System
   ----------------------------- */

function updateNotificationBadges() {
  // Update Overall tab badge
  updateTabBadge('overall', PENDING_UPDATES.leaderboard);
  
  // Update Round Results tab badge
  const hasRoundUpdates = PENDING_UPDATES.roundResults.size > 0;
  updateTabBadge('round', hasRoundUpdates);
  
  // Update Drivers tab badge
  const hasDriverUpdates = PENDING_UPDATES.driverProfiles.size > 0 || 
                          PENDING_UPDATES.driverEquipment.size > 0;
  updateTabBadge('drivers', hasDriverUpdates);
  
  // Update Setup tab badge
  const hasSetupUpdates = PENDING_UPDATES.setupRounds.size > 0;
  updateTabBadge('setup', hasSetupUpdates);
}

function updateTabBadge(tabName, hasUpdate) {
  const tabButton = document.querySelector(`.tab-button[onclick*="${tabName}"]`);
  if (!tabButton) return;
  
  // Remove existing badge
  const existingBadge = tabButton.querySelector('.notification-badge');
  if (existingBadge) existingBadge.remove();
  
  if (hasUpdate) {
    // Add pulsating badge
    const badge = document.createElement('span');
    badge.className = 'notification-badge';
    badge.textContent = '●';
    tabButton.appendChild(badge);
    
    // Add pulsate class to tab
    tabButton.classList.add('has-notification');
  } else {
    tabButton.classList.remove('has-notification');
  }
}

/* -----------------------------
   PART 6: Mark as Seen Functions
   ----------------------------- */

function markLeaderboardAsSeen() {
  USER_LAST_SEEN.leaderboard = Date.now();
  PENDING_UPDATES.leaderboard = false;
  saveLastSeenTimestamps();
  updateNotificationBadges();
}

function markRoundResultAsSeen(roundKey) {
  USER_LAST_SEEN.roundResults[roundKey] = Date.now();
  PENDING_UPDATES.roundResults.delete(roundKey);
  saveLastSeenTimestamps();
  updateNotificationBadges();
  
  // Highlight the round briefly
  highlightElement(`details-${roundKey}`);
}

function markDriverProfileAsSeen(driverName) {
  USER_LAST_SEEN.driverProfiles[driverName] = Date.now();
  PENDING_UPDATES.driverProfiles.delete(driverName);
  saveLastSeenTimestamps();
  updateNotificationBadges();
}

function markDriverEquipmentAsSeen(driverName) {
  USER_LAST_SEEN.driverEquipment[driverName] = Date.now();
  PENDING_UPDATES.driverEquipment.delete(driverName);
  saveLastSeenTimestamps();
  updateNotificationBadges();
}

function markSetupRoundAsSeen(roundKey) {
  USER_LAST_SEEN.setupRounds[roundKey] = Date.now();
  PENDING_UPDATES.setupRounds.delete(roundKey);
  saveLastSeenTimestamps();
  updateNotificationBadges();
}

/* -----------------------------
   PART 7: Highlight Animations
   ----------------------------- */

function highlightElement(elementId, color = '#ffeb3b') {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  // Add highlight class
  element.classList.add('update-highlight');
  
  // Apply color
  const originalBg = element.style.backgroundColor;
  element.style.backgroundColor = color;
  element.style.transition = 'background-color 0.5s ease';
  
  // Scroll into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  
  // Remove after 2 seconds
  setTimeout(() => {
    element.style.backgroundColor = originalBg;
    setTimeout(() => {
      element.classList.remove('update-highlight');
    }, 500);
  }, 2000);
}

function pulsateFlipButton(driverName) {
  const driverCard = document.querySelector(`.driver-card[data-driver="${driverName}"]`);
  if (!driverCard) return;
  
  const flipButton = driverCard.querySelector('.flip-card-button');
  if (!flipButton) return;
  
  // Add pulsate class
  flipButton.classList.add('pulsate-notification');
  
  // Add notification dot
  if (!flipButton.querySelector('.flip-notification-dot')) {
    const dot = document.createElement('span');
    dot.className = 'flip-notification-dot';
    flipButton.appendChild(dot);
  }
}

function removePulsateFlipButton(driverName) {
  const driverCard = document.querySelector(`.driver-card[data-driver="${driverName}"]`);
  if (!driverCard) return;
  
  const flipButton = driverCard.querySelector('.flip-card-button');
  if (!flipButton) return;
  
  flipButton.classList.remove('pulsate-notification');
  
  const dot = flipButton.querySelector('.flip-notification-dot');
  if (dot) dot.remove();
}

/* -----------------------------
   PART 8: Integration with Existing Functions
   ----------------------------- */

// Modify existing showTab function to mark as seen
const originalShowTab = window.showTab || showTab;
function showTab(tabName, sourceButton = null) {
  // Call original function
  originalShowTab(tabName, sourceButton);
  
  // Mark tab as seen
  if (tabName === 'overall') {
    setTimeout(() => markLeaderboardAsSeen(), 1000);
  }
  
  // Update badges
  updateNotificationBadges();
}

// Modify toggleRound to mark as seen
const originalToggleRound = window.toggleRound || toggleRound;
function toggleRound(key) {
  originalToggleRound(key);
  
  const details = document.getElementById(`details-${key}`);
  if (details && details.classList.contains('expanded')) {
    // User opened the round - mark as seen
    setTimeout(() => markRoundResultAsSeen(key), 500);
  }
}

// Modify flipDriverCard to mark equipment as seen
const originalFlipDriverCard = window.flipDriverCard || flipDriverCard;
function flipDriverCard(button) {
  originalFlipDriverCard(button);
  
  const card = button.closest('.driver-card');
  if (card && card.classList.contains('flipped')) {
    const driverName = card.getAttribute('data-driver');
    if (driverName && PENDING_UPDATES.driverEquipment.has(driverName)) {
      setTimeout(() => {
        markDriverEquipmentAsSeen(driverName);
        removePulsateFlipButton(driverName);
      }, 500);
    }
  }
}

/* -----------------------------
   PART 9: Apply Visual Indicators on Page Load
   ----------------------------- */

function applyNotificationIndicators() {
  if (!currentUser) return;
  
  // Pulsate flip buttons for drivers with equipment updates
  PENDING_UPDATES.driverEquipment.forEach(driverName => {
    pulsateFlipButton(driverName);
  });
  
  // Add glow to driver cards with profile updates
  PENDING_UPDATES.driverProfiles.forEach(driverName => {
    const card = document.querySelector(`.driver-card[data-driver="${driverName}"]`);
    if (card) {
      card.classList.add('profile-updated');
    }
  });
  
  // Add indicators to round headers with updates
  PENDING_UPDATES.roundResults.forEach(roundKey => {
    const header = document.querySelector(`#details-${roundKey}`)?.previousElementSibling;
    if (header) {
      header.classList.add('round-updated');
      
      // Add notification dot
      if (!header.querySelector('.round-notification-dot')) {
        const dot = document.createElement('span');
        dot.className = 'round-notification-dot';
        dot.textContent = '●';
        header.querySelector('.round-info-column')?.appendChild(dot);
      }
    }
  });
}

/* -----------------------------
   PART 10: CSS for Animations (Add to styles.css)
   ----------------------------- */

const NOTIFICATION_CSS = `
/* Notification Badge on Tabs */
.notification-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 10px;
  height: 10px;
  background: #ff4444;
  border-radius: 50%;
  animation: pulse-notification 2s ease-in-out infinite;
  box-shadow: 0 0 10px rgba(255, 68, 68, 0.8);
}

.tab-button.has-notification {
  position: relative;
  animation: tab-pulse 2s ease-in-out infinite;
}

@keyframes pulse-notification {
  0%, 100% { 
    transform: scale(1); 
    opacity: 1; 
  }
  50% { 
    transform: scale(1.3); 
    opacity: 0.7; 
  }
}

@keyframes tab-pulse {
  0%, 100% { 
    box-shadow: 0 4px 6px rgba(102, 126, 234, 0.2); 
  }
  50% { 
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.6); 
  }
}

/* Flip Button Pulsate */
.flip-card-button.pulsate-notification {
  animation: flip-button-pulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 20px rgba(102, 126, 234, 0.8);
}

.flip-notification-dot {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 12px;
  height: 12px;
  background: #ff4444;
  border-radius: 50%;
  border: 2px solid white;
  animation: pulse-notification 2s ease-in-out infinite;
}

@keyframes flip-button-pulse {
  0%, 100% { 
    transform: scale(1); 
  }
  50% { 
    transform: scale(1.1); 
  }
}

/* Driver Card Profile Update Glow */
.driver-card.profile-updated {
  animation: card-glow 2s ease-in-out infinite;
  border: 2px solid rgba(102, 126, 234, 0.5);
}

@keyframes card-glow {
  0%, 100% { 
    box-shadow: 0 4px 6px rgba(0,0,0,0.1); 
  }
  50% { 
    box-shadow: 0 4px 30px rgba(102, 126, 234, 0.6); 
  }
}

/* Round Header Update Indicator */
.round-header.round-updated {
  background: linear-gradient(135deg, #667eea10 0%, #764ba220 100%);
  border-left: 4px solid #667eea;
  animation: round-pulse 2s ease-in-out infinite;
}

.round-notification-dot {
  display: inline-block;
  margin-left: 10px;
  color: #ff4444;
  font-size: 20px;
  animation: pulse-notification 2s ease-in-out infinite;
}

@keyframes round-pulse {
  0%, 100% { 
    background: linear-gradient(135deg, #667eea10 0%, #764ba220 100%); 
  }
  50% { 
    background: linear-gradient(135deg, #667eea20 0%, #764ba240 100%); 
  }
}

/* Highlight Flash Animation */
.update-highlight {
  animation: highlight-flash 2s ease-in-out;
}

@keyframes highlight-flash {
  0%, 100% { 
    background-color: transparent; 
  }
  50% { 
    background-color: #ffeb3b; 
  }
}

/* Mobile Responsive Adjustments */
@media (max-width: 768px) {
  .notification-badge {
    width: 8px;
    height: 8px;
    top: 5px;
    right: 5px;
  }
  
  .flip-notification-dot {
    width: 10px;
    height: 10px;
  }
}
`;

/* -----------------------------
   PART 11: Initialization
   ----------------------------- */

// Call this after user logs in
function initNotifications() {
  if (!currentUser) return;
  
  console.log('🔔 Setting up notification system...');
  
  // Add CSS
  if (!document.getElementById('notification-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = NOTIFICATION_CSS;
    document.head.appendChild(style);
  }
  
  // Initialize system
  initializeNotificationSystem();
}

// Add to your existing applyUserUI function
const originalApplyUserUI = window.applyUserUI || applyUserUI;
function applyUserUI() {
  originalApplyUserUI();
  
  if (currentUser) {
    initNotifications();
  }
}

/* -----------------------------
   USAGE EXAMPLES
   ----------------------------- */

/*
// When user views leaderboard
loadLeaderboard(); // existing function
setTimeout(() => markLeaderboardAsSeen(), 1000);

// When user opens a round
toggleRound('S3-R5'); // existing function
// Auto-marks as seen when expanded

// When user flips to equipment
flipDriverCard(button); // existing function
// Auto-marks equipment as seen when flipped

// Manual highlighting
highlightElement('details-S3-R5', '#ffeb3b');

// Manual pulsate
pulsateFlipButton('Olaf');
*/
