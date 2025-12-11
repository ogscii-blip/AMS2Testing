/* =========================================================
   NOTIFICATION SYSTEM - SAFE VERSION (No Function Wrapping)
   Add this at the END of your existing script.js file
   ========================================================= */

// ============================================================================
// STEP 1: Add these global variables at the top of your script.js
// ============================================================================

/*
// Add these with your other global variables (near the top where you have CACHE, ALLOWED_USERS, etc.)

let USER_LAST_SEEN = {
  leaderboard: null,
  roundResults: {},
  driverProfiles: {},
  driverEquipment: {},
  setupRounds: {}
};

let PENDING_UPDATES = {
  leaderboard: false,
  roundResults: new Set(),
  driverProfiles: new Set(),
  driverEquipment: new Set(),
  setupRounds: new Set()
};
*/

// ============================================================================
// STEP 2: Add these functions at the END of your script.js
// ============================================================================

/* -----------------------------
   Notification System Functions
   ----------------------------- */

async function initializeNotificationSystem() {
  if (!currentUser) return;
  
  console.log('🔔 Initializing notification system for', currentUser.name);
  
  const userKey = encodeKey(currentUser.name);
  const lastSeenRef = window.firebaseRef(window.firebaseDB, `User_Last_Seen/${userKey}`);
  
  try {
    const snapshot = await window.firebaseGet(lastSeenRef);
    const savedLastSeen = snapshot.val();
    
    if (savedLastSeen) {
      USER_LAST_SEEN = savedLastSeen;
      console.log('✅ Loaded last seen data');
    } else {
      USER_LAST_SEEN = {
        leaderboard: Date.now(),
        roundResults: {},
        driverProfiles: {},
        driverEquipment: {},
        setupRounds: {}
      };
      await saveLastSeenTimestamps();
    }
    
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
  } catch (err) {
    console.error('❌ Error saving last seen data:', err);
  }
}

function startListeningForUpdates() {
  console.log('👂 Starting to listen for updates...');
  
  const roundDataRef = window.firebaseRef(window.firebaseDB, 'Round_Data');
  window.firebaseOnValue(roundDataRef, (snapshot) => {
    checkForRoundResultUpdates(snapshot.val());
  });
  
  const profilesRef = window.firebaseRef(window.firebaseDB, 'Driver_Profiles');
  window.firebaseOnValue(profilesRef, (snapshot) => {
    checkForProfileUpdates(snapshot.val());
  });
  
  const setupRef = window.firebaseRef(window.firebaseDB, 'Form_responses_2');
  window.firebaseOnValue(setupRef, (snapshot) => {
    checkForSetupUpdates(snapshot.val());
  });
  
  const leaderboardRef = window.firebaseRef(window.firebaseDB, 'Leaderboard');
  window.firebaseOnValue(leaderboardRef, (snapshot) => {
    checkForLeaderboardUpdates(snapshot.val());
  });
}

function checkForRoundResultUpdates(roundData) {
  if (!currentUser || !roundData) return;
  
  const roundArray = toArray(roundData);
  
  // ✅ ADD THIS SAFETY CHECK:
  if (!USER_LAST_SEEN.roundResults) {
    USER_LAST_SEEN.roundResults = {};
  }
  
  roundArray.forEach(result => {
    if (!result || !result.Season || !result.Round) return;
    
    const roundKey = `S${result.Season}-R${result.Round}`;
    const resultTimestamp = new Date(result.Last_Modified || result.Timestamp).getTime();
    const lastSeen = USER_LAST_SEEN.roundResults[roundKey] || 0;
    
    if (resultTimestamp > lastSeen) {
      PENDING_UPDATES.roundResults.add(roundKey);
    }
  });
  
  updateNotificationBadges();
}

function checkForProfileUpdates(profilesData) {
  if (!currentUser || !profilesData) return;
  
  const profilesArray = toArray(profilesData);
  
  // ✅ ADD THESE SAFETY CHECKS:
  if (!USER_LAST_SEEN.driverProfiles) {
    USER_LAST_SEEN.driverProfiles = {};
  }
  if (!USER_LAST_SEEN.driverEquipment) {
    USER_LAST_SEEN.driverEquipment = {};
  }
  
  profilesArray.forEach(profile => {
    if (!profile || !profile.Name) return;
    
    const driverName = profile.Name;
    const profileTimestamp = new Date(profile.Last_Modified || Date.now()).getTime();
    const lastSeen = USER_LAST_SEEN.driverProfiles[driverName] || 0;
    
    if (profileTimestamp > lastSeen) {
      PENDING_UPDATES.driverProfiles.add(driverName);
    }
    
    if (profile.equipment && profile.equipment_last_modified) {
      const equipTimestamp = new Date(profile.equipment_last_modified).getTime();
      const equipLastSeen = USER_LAST_SEEN.driverEquipment[driverName] || 0;
      
      if (equipTimestamp > equipLastSeen) {
        PENDING_UPDATES.driverEquipment.add(driverName);
      }
    }
  });
  
  updateNotificationBadges();
}

function checkForSetupUpdates(setupData) {
  if (!currentUser || !setupData) return;
  
  const setupArray = toArray(setupData);
  
  // ✅ ADD THIS SAFETY CHECK:
  if (!USER_LAST_SEEN.setupRounds) {
    USER_LAST_SEEN.setupRounds = {};
  }
  
  setupArray.forEach(setup => {
    if (!setup || !setup.Season || !setup.Round_Number) return;
    
    const roundKey = `S${setup.Season}-R${setup.Round_Number}`;
    const setupTimestamp = new Date(setup.Timestamp).getTime();
    const lastSeen = USER_LAST_SEEN.setupRounds[roundKey] || 0;
    
    if (setupTimestamp > lastSeen) {
      PENDING_UPDATES.setupRounds.add(roundKey);
    }
  });
  
  updateNotificationBadges();
}

function checkForLeaderboardUpdates(leaderboardData) {
  if (!currentUser || !leaderboardData) return;
  
  const leaderboardArray = toArray(leaderboardData);
  const lastSeen = USER_LAST_SEEN.leaderboard || 0;
  
  const hasUpdate = leaderboardArray.some(entry => {
    if (!entry || !entry.Last_Modified) return false;
    const entryTime = new Date(entry.Last_Modified).getTime();
    return entryTime > lastSeen;
  });
  
  if (hasUpdate) {
    PENDING_UPDATES.leaderboard = true;
  }
  
  updateNotificationBadges();
}

function updateNotificationBadges() {
  updateTabBadge('overall', PENDING_UPDATES.leaderboard);
  
  const hasRoundUpdates = PENDING_UPDATES.roundResults.size > 0;
  updateTabBadge('round', hasRoundUpdates);
  
  const hasDriverUpdates = PENDING_UPDATES.driverProfiles.size > 0 || 
                          PENDING_UPDATES.driverEquipment.size > 0;
  updateTabBadge('drivers', hasDriverUpdates);
  
  const hasSetupUpdates = PENDING_UPDATES.setupRounds.size > 0;
  updateTabBadge('setup', hasSetupUpdates);
}

function updateTabBadge(tabName, hasUpdate) {
  const tabButton = document.querySelector(`.tab-button[onclick*="${tabName}"]`);
  if (!tabButton) return;
  
  const existingBadge = tabButton.querySelector('.notification-badge');
  if (existingBadge) existingBadge.remove();
  
  if (hasUpdate) {
    const badge = document.createElement('span');
    badge.className = 'notification-badge';
    badge.textContent = '●';
    tabButton.appendChild(badge);
    tabButton.classList.add('has-notification');
  } else {
    tabButton.classList.remove('has-notification');
  }
}

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

function highlightElement(elementId, color = '#ffeb3b') {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  element.classList.add('update-highlight');
  
  const originalBg = element.style.backgroundColor;
  element.style.backgroundColor = color;
  element.style.transition = 'background-color 0.5s ease';
  
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  
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
  
  flipButton.classList.add('pulsate-notification');
  
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

function applyNotificationIndicators() {
  if (!currentUser) return;
  
  PENDING_UPDATES.driverEquipment.forEach(driverName => {
    pulsateFlipButton(driverName);
  });
  
  PENDING_UPDATES.driverProfiles.forEach(driverName => {
    const card = document.querySelector(`.driver-card[data-driver="${driverName}"]`);
    if (card) {
      card.classList.add('profile-updated');
    }
  });
  
  PENDING_UPDATES.roundResults.forEach(roundKey => {
    const details = document.getElementById(`details-${roundKey}`);
    if (!details) return;
    
    const header = details.previousElementSibling;
    if (header) {
      header.classList.add('round-updated');
      
      if (!header.querySelector('.round-notification-dot')) {
        const dot = document.createElement('span');
        dot.className = 'round-notification-dot';
        dot.textContent = '●';
        const infoColumn = header.querySelector('.round-info-column');
        if (infoColumn) infoColumn.appendChild(dot);
      }
    }
  });
}

function injectNotificationCSS() {
  if (document.getElementById('notification-styles')) return;
  
  const css = `
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
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.7; }
}

@keyframes tab-pulse {
  0%, 100% { box-shadow: 0 4px 6px rgba(102, 126, 234, 0.2); }
  50% { box-shadow: 0 4px 15px rgba(102, 126, 234, 0.6); }
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
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

/* Driver Card Profile Update Glow */
.driver-card.profile-updated {
  animation: card-glow 2s ease-in-out infinite;
  border: 2px solid rgba(102, 126, 234, 0.5);
}

@keyframes card-glow {
  0%, 100% { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
  50% { box-shadow: 0 4px 30px rgba(102, 126, 234, 0.6); }
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
  0%, 100% { background: linear-gradient(135deg, #667eea10 0%, #764ba220 100%); }
  50% { background: linear-gradient(135deg, #667eea20 0%, #764ba240 100%); }
}

/* Highlight Flash Animation */
.update-highlight {
  animation: highlight-flash 2s ease-in-out;
}

@keyframes highlight-flash {
  0%, 100% { background-color: transparent; }
  50% { background-color: #ffeb3b; }
}

/* Mobile Responsive */
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
  
  const style = document.createElement('style');
  style.id = 'notification-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

// ============================================================================
// STEP 3: Modify these EXISTING functions in your script.js
// ============================================================================

/*
// FIND your existing showTab function and ADD these lines:

function showTab(tabName, sourceButton = null) {
  // ... your existing code ...
  
  // ADD THESE LINES at the end:
  if (currentUser) {
    if (tabName === 'overall') {
      setTimeout(() => markLeaderboardAsSeen(), 1000);
    }
    updateNotificationBadges();
  }
}

// ----------------------------------------------------------------

// FIND your existing toggleRound function and ADD these lines:

function toggleRound(key) {
  const details = document.getElementById(`details-${key}`);
  const icon = document.getElementById(`toggle-${key}`);
  if (!details) return;
  details.classList.toggle('expanded');
  if (icon) icon.classList.toggle('expanded');
  
  // ADD THESE LINES:
  if (currentUser && details.classList.contains('expanded')) {
    setTimeout(() => markRoundResultAsSeen(key), 500);
  }
}

// ----------------------------------------------------------------

// FIND your existing flipDriverCard function and ADD these lines:

function flipDriverCard(button) {
  const card = button.closest('.driver-card');
  if (card) {
    card.classList.toggle('flipped');
    
    // ADD THESE LINES:
    if (currentUser && card.classList.contains('flipped')) {
      const driverName = card.getAttribute('data-driver');
      if (driverName && PENDING_UPDATES.driverEquipment.has(driverName)) {
        setTimeout(() => {
          markDriverEquipmentAsSeen(driverName);
          removePulsateFlipButton(driverName);
        }, 500);
      }
    }
  }
}

// ----------------------------------------------------------------

// FIND your existing applyUserUI function and ADD these lines:

function applyUserUI() {
  // ... your existing code ...
  
  // ADD THESE LINES at the end, inside the if(currentUser) block:
  if (currentUser) {
    // ... your existing code ...
    
    // ADD THESE:
    injectNotificationCSS();
    initializeNotificationSystem();
  }
}

// ----------------------------------------------------------------

// FIND your existing loadDriverStats function and ADD this line at the END:

async function loadDriverStats() {
  // ... your existing code ...
  
  // ADD THIS LINE at the very end:
  if (currentUser) {
    setTimeout(() => applyNotificationIndicators(), 500);
  }
}

// ----------------------------------------------------------------

// FIND your existing loadRoundData function and ADD this line at the END:

async function loadRoundData() {
  // ... your existing code ...
  
  // ADD THIS LINE at the very end:
  if (currentUser) {
    setTimeout(() => applyNotificationIndicators(), 500);
  }
}
*/
